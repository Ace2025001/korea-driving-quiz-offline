"""将固定指纹的 KoROAD 中文 PDF 转换为私人离线题库。"""
import argparse
import base64
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

import pymupdf as pdf
from korean import extract as extract_korean
from video import transcode

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://www.safedriving.or.kr/subExamBoard/selectSubExamBoardEngInfo.do?menuCd=MN-PO-1152&bbscttSn="
DOWNLOAD = "https://www.koroad.or.kr/file/FileDown.do?atchFileId="
VERSIONS = {
    "2026-03-09": ("1924", "FID00138433", "307227bc8b8fc06698c90b4eb76dbb02d8ded8384d7696893b7c564d4c38a043", 1000, 335),
    "2026-11-30": ("1959", "FID00143760", "ec8cba3682c7df2a190657c8ac67e16cb064686e680cc4e5d896393a3cf024d8", 1136, 352),
}
KOREAN = {
    "2026-03-09": ("FID00137702", "b718e38c5f29ac94258a0587bbc98c17ca8ae0153e8948a1525a33ca38354eb0"),
    "2026-11-30": ("FID00143753", "1bfb6ce0c96539645833a2a426c23e10508da28eef8c071d62524b7c5c13ec0e"),
}
HEADER = re.compile(r"^(\d{1,4})(?:[.．]\s*|(?<=455) +)(.*)$")
ANSWER = re.compile(r"^■\s*正确答案\s*[:：]\s*(\d(?:\s*[,，.]\s*\d)*)\s*$")
OPTIONS = re.compile(r"([①②③④⑤⑥⑦⑧⑨⑩])")
OPTION_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩"
RULES = json.loads((ROOT / "data/rules.json").read_text(encoding="utf-8"))
TOPICS = [
    ("交通信号", r"信号灯|信号标志|红灯|绿灯|闪烁"),
    ("道路标志", r"标志|标线|标识|标牌|指路牌"),
    ("行人保护", r"行人|人行横道|斑马线"),
    ("儿童及保护区", r"儿童|保护区|校车"),
    ("道路通行", r"车道|交叉路口|路肩|超车|让行|让路|停车|掉头|回转"),
    ("驾驶证与行政规定", r"驾驶证|扣分|罚款|处罚|吊销|罚金"),
    ("危险驾驶与事故", r"酒[后驾精]|碰撞|事故|紧急|药物|防御"),
    ("车辆安全与维护", r"轮胎|灯光|制动|安全带|载重|发动机|蓄电池"),
]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def canonical(x):
    return json.dumps(x, ensure_ascii=False, separators=(",", ":")).encode()

def join_lines(lines):
    # 中文自然换行拼回原句；拉丁字母或数字之间保留词间空格。
    s = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        gap = " " if s and re.fullmatch(r"[a-zA-Z0-9]", s[-1]) and re.match(r"[a-zA-Z0-9]", line) else ""
        s += gap + line
    return re.sub(r"[ \t\u00a0]+", " ", s).replace("\u200c","")

def parse_content(number, body, answer):
    # 选项大都独占一行，个别图片题同行列出多项。
    prompt, choices = [], []
    for line in body:
        line = re.sub(r"^[➀➁➂➃➄➅➆➇➈➉]", lambda m: OPTION_NUMBERS["➀➁➂➃➄➅➆➇➈➉".index(m[0])], line)
        match = OPTIONS.match(line)
        if match:
            positions = list(OPTIONS.finditer(line))
            if len(positions) > 1:
                # 只识别按顺序排列、前有多个空格的同行选项；选项文中的带圈数字保留。
                positions = [positions[0]] + [p for p in positions[1:] if re.search(r"\s{2,}$", line[:p.start()])]
                if [OPTION_NUMBERS.index(p[0]) for p in positions] != list(range(len(choices), len(choices)+len(positions))):
                    positions = positions[:1]
            for i, m in enumerate(positions):
                assert OPTION_NUMBERS.index(m[0]) == len(choices), f"{number}: 选项次序不符"
                choices.append([line[m.end():positions[i+1].start() if i+1<len(positions) else len(line)]])
        elif choices:
            choices[-1].append(line)
        else:
            prompt.append(line)
    options = [[str(i),join_lines(c)] for i,c in enumerate(choices,1)]
    key = sorted(re.findall(r"\d",answer))
    assert 3 <= len(options) <= 6 and all(o[1] for o in options), f"{number}: 选项缺失 {len(options)}"
    assert len(key) in (1,2) and len(set(key)) == len(key) and set(key)<= {o[0] for o in options}, f"{number}: 答案有误"
    prompt_text=join_lines(prompt)
    assert prompt_text, f"{number}: 题干缺失"
    return prompt_text, options, key

def page_rows(page):
    rows, current, side, last = [], None, [], 0.0
    image_boxes = [pdf.Rect(x["bbox"]) for x in page.get_image_info() if min(x["width"],x["height"]) > 10]
    # 左列为题干/选项/答案，右列为图示及图注。保留 PDF 正文的阅读顺序。
    for block in page.get_text("dict", flags=pdf.TEXTFLAGS_TEXT)["blocks"]:
        for line in block["lines"]:
            text = "".join(s["text"] for s in line["spans"]).strip()
            if not text:
                continue
            rect = pdf.Rect(line["bbox"])
            if image_boxes and rect.x0 >= 485:
                side.append((rect,text))
                continue
            header = HEADER.match(text) if current is None else None
            if header:
                current = [int(header[1]), [header[2]], last]
                continue
            assert current is not None, f"第 {page.number+1} 页：发现题块外文字"
            answer = ANSWER.match(text)
            if answer:
                rows.append((current[0],current[1],answer[1],current[2],rect.y0))
                current, last = None, rect.y1
            else:
                current[1].append(text)
    assert current is None, f"第 {page.number+1} 页题目跨页"
    for n, body, answer, a, b in rows:
        images = [r for r in image_boxes if a < (r.y0+r.y1)/2 < b]
        labels = [(r,t) for r,t in side if a < (r.y0+r.y1)/2 < b]
        yield n, body, answer, images, labels

def crop(page, images, labels):
    rect = pdf.Rect(images[0])
    for b in [*images,*labels]:
        rect |= b
    rect = pdf.Rect(rect.x0-3,rect.y0-3,rect.x1+3,rect.y1+3) & page.rect
    pix=page.get_pixmap(matrix=pdf.Matrix(1.5,1.5),clip=rect,alpha=False)
    return min(((pix.tobytes("png"),"image/png"),(pix.tobytes("jpeg",jpg_quality=88),"image/jpeg")),key=lambda x:len(x[0]))

def convert(filename, version, videos, movie_manifest, korean_file):
    board, file_id, expected_sha, count, pages = VERSIONS[version]
    attachment = filename.read_bytes()
    assert sha(attachment) == expected_sha, "PDF 的 SHA-256 与该版本的公开记录不同，已停止转换。"
    url = SOURCE+board
    bank = dict(schema_version="1.0",bank_version=version,effective_date=version,source_url=url,
                attachment_sha256=expected_sha,questions=[])
    manifest = dict(effective_date=version,source_url=url,download_url=DOWNLOAD+file_id+"&fileSn=0",
                    attachment_sha256=expected_sha,pages=pages,expected_questions=count,
                    korean_attachment_sha256=KOREAN[version][1],
                    ordinary_ranges=[[1,1121 if count==1136 else 1000]],questions={})
    stats=Counter()
    korean={}
    if korean_file:
        ko=korean_file.read_bytes()
        assert sha(ko)==KOREAN[version][1], "韩文 PDF 指纹不是该版本的官方附件"
        korean=extract_korean(ko,count)
    supplemental = {}
    if korean:
        # 韩文原件用于独立答案核对，但不把异版附图或答案填进中文卷。
        supplemental={n:[exp,page] for n,(_,exp,page,_) in korean.items() if exp}
    with pdf.open(stream=attachment,filetype="pdf") as doc:
        assert len(doc) == pages
        # 另用完整文本层逐页读印刷答案，检测题块解析过程中漏行或错配。
        independent = []
        for page in doc:
            independent.extend((page.number+1,sorted(re.findall(r"\d",m[1]))) for m in
              re.finditer(r"^[ \t]*■[ \t]*正确答案[ \t]*[:：][ \t]*(\d(?:[ \t]*[,，.][ \t]*\d)*)[ \t]*$",page.get_text(),re.M))
            for n,body,answer,images,labels in page_rows(page):
                assert 1 <= n <= count, f"第 {page.number+1} 页：题号超出范围（{n}）"
                text, options, key = parse_content(n,body,answer)
                media_kind = "video" if 966<=n<=1000 else "image" if 681<=n<=965 else "none"
                media, mime = crop(page,images,[r for r,_ in labels]) if images else (None,None)
                if media_kind == "image":
                    if not media: stats["image_missing"]+=1
                if media and media_kind != "image":
                    raise ValueError(f"{n}: 图片超出已审计区间")
                caption = "\n".join(label for _,label in labels)
                if media_kind == "image" and caption.startswith("■"):
                    text += "\n" + caption
                video = movie_manifest.get(str(n))
                expected_video = video["offline_sha256"] if video else None
                video_file = videos / (str(n)+".mp4") if videos else None
                video_bytes = video_file.read_bytes() if media_kind=="video" and video_file and video_file.is_file() else None
                if video_bytes is not None:
                    assert video and video_bytes[4:8]==b"ftyp", f"{n}: 不是已定位题号的 MP4 素材"
                    if sha(video_bytes)!=expected_video:
                        stats["video_unmatched"]+=1
                asset = lambda b,mime: "data:"+mime+";base64,"+base64.b64encode(b).decode() if b else None
                topics = [label for label,pattern in TOPICS if re.search(pattern,text)]
                if media_kind == "image" and 866<=n<=965 and "道路标志" not in topics:
                    topics.append("道路标志")
                if n>1121:
                    topics.append("大型与特殊车辆")
                if not topics:
                    topics.append("安全驾驶综合")
                related = text + " " + " ".join(v for i,v in options if i in key)
                matched = [r for r in RULES if r.get("match") and re.search(r["match"],related)]
                trap_tags=[r["title"] for r in matched]
                refs=list({(ref["label"],ref["url"]):ref for r in matched for ref in r["refs"]}.values())[:12]
                explanation = "\n".join("关联考点｜"+r["title"]+"："+r["kr"] for r in matched)
                kind = "single" if len(key)==1 else "multiple"
                page_no=page.number+1
                q=dict(question_id=str(n),question_type=kind,prompt_zh=text,
                       options=[dict(id=i,text=t) for i,t in options],correct_answers=key,points=None,
                       media_kind=media_kind,image_asset=asset(media,mime),video_asset=asset(video_bytes,"video/mp4"),
                       legal_refs=refs,trap_tags=trap_tags,topics=topics,explanation_zh=explanation,
                       verification_status="verified",copyright_status="personal_only",
                       evidence=dict(page=page_no,method="官方原件指纹匹配；按页抽取，并与 PDF 全文印刷答案序列复核"))
                if korean:
                    assert korean[n][0]==key, f"{n}: 韩文和中文公布答案不同"
                ko_evidence=supplemental.get(n)
                if ko_evidence:
                    q["official_explanation_ko"],q["evidence"]["ko_page"]=ko_evidence
                    stats["ko_explanation"]+=1
                bank["questions"].append(q)
                manifest["questions"][str(n)]=[sha(canonical([str(n),kind,text,options,key,page_no,media_kind])),
                     sha(media) if media else expected_video, sha(canonical(ko_evidence)) if ko_evidence else None]
                stats[media_kind]+=1
                if video_bytes:
                    stats["video_local"]+=1
        assert sorted(int(q["question_id"]) for q in bank["questions"])==list(range(1,count+1)), "题号缺失或重复"
        assert independent==[(q["evidence"]["page"],q["correct_answers"]) for q in bank["questions"]], "印刷答案的交叉核对失败"
        bank["questions"].sort(key=lambda q:int(q["question_id"]))
        manifest["media_counts"]={k:v for k,v in stats.items() if not k.startswith("video_")}
    return bank,manifest

def fetch(url, file, max_size):
    request=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (local KoROAD practice import)"})
    with urllib.request.urlopen(request,timeout=40) as response:
        assert response.geturl().startswith("https://www.koroad.or.kr/"),"下载重定向不在 KoROAD 域名"
        length=0
        temp=file.with_suffix(".partial")
        try:
            with temp.open("wb") as out:
                while chunk:=response.read(1024*1024):
                    length+=len(chunk)
                    assert length<=max_size,"附件超过尺寸限制"
                    out.write(chunk)
            temp.replace(file)
        finally:
            temp.unlink(missing_ok=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--version",choices=VERSIONS,required=True)
    entry=p.add_mutually_exclusive_group(required=True)
    entry.add_argument("--pdf",type=Path,help="官方一、二类中文 PDF")
    entry.add_argument("--download",action="store_true",help="直接从 KoROAD 下载 PDF（需要联网）")
    p.add_argument("--download-videos",action="store_true",help="从 KoROAD 下载已核对的视频（需要联网）")
    p.add_argument("--videos",type=Path,help="本地 MP4 文件夹，文件名为题号.mp4")
    p.add_argument("--ko-pdf",type=Path,help="同版官方韩文 PDF（用于解析和交叉核对）")
    p.add_argument("--download-korean",action="store_true",help="自动下载同版韩文 PDF")
    p.add_argument("--out",type=Path,default=ROOT/"private")
    p.add_argument("--audit-manifest",type=Path,help="另外保存本次校验清单，供开发审计")
    args=p.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    _, file_id, expected, _, _ = VERSIONS[args.version]
    video_list=json.loads((ROOT/"data/videos.json").read_text(encoding="utf-8")).get(args.version,{})
    file=args.pdf or args.out/(args.version+".pdf")
    if args.download and (not file.is_file() or sha(file.read_bytes())!=expected):
        fetch(DOWNLOAD+file_id+"&fileSn=0",file,80*1024*1024)
    ko_file=args.ko_pdf
    if args.download_korean:
        ko_id,ko_hash=KOREAN[args.version]
        ko_file=ko_file or args.out/(args.version+"-ko.pdf")
        if not ko_file.is_file() or sha(ko_file.read_bytes())!=ko_hash:
            fetch(DOWNLOAD+ko_id+"&fileSn=0",ko_file,80*1024*1024)
    folder=args.videos or (args.out/(args.version+"-videos") if args.download_videos else None)
    if args.download_videos:
        folder.mkdir(parents=True,exist_ok=True)
        from concurrent.futures import ThreadPoolExecutor
        def load(entry):
            number,v=entry
            f=folder/(number+".mp4")
            if f.is_file():
                return
            source=folder/(number+".source")
            fetch(v["url"],source,180*1024*1024)
            with source.open("rb") as file:
                assert hashlib.file_digest(file,"sha256").hexdigest()==v["sha256"],f"{number}: 官网视频指纹变化"
            transcode(source,f)
            source.unlink()
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(load,video_list.items()))
    bank, manifest = convert(file,args.version,folder,video_list,ko_file)
    dest=args.out/(args.version+".bank.json")
    dest.write_bytes(canonical(bank))
    if args.audit_manifest:
        args.audit_manifest.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"{args.version}：{len(bank['questions'])} 道，答案全部通过原件文字层复核，{manifest['media_counts']}；{dest}")

if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, subprocess.CalledProcessError) as e:
        sys.exit("转换失败："+str(e))
