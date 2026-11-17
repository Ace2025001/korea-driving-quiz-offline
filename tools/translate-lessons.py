"""将本地题库中的 KoROAD 韩文解析译为私人中文资料（无网络请求）。"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request

MODEL_HASH = "2dd4860e679616ff223f46b7d8262d816996a7f25aea0adc39836131b1ef8558"
ROOT = Path(__file__).resolve().parents[1]
TEACHING = ROOT / "data/coaching.json"
MANIFEST = ROOT / "data/official-manifest.json"
OPTIONS = "①②③④⑤⑥⑦⑧⑨⑩"
HANGUL = re.compile(r"[가-힣\u1100-\u11ff]")
FIGURES = re.compile(r"(?<![A-Za-z0-9])\d+(?:,\d{3})*(?:\.\d+)?")
SENTENCE = re.compile(r"(?<=[!?。])\s+|(?<=[가-힣]\.)\s+|(?=\s+[①②③④⑤⑥⑦⑧⑨⑩])")
# 使用中文选项的符号做锚点，不让机器翻译重排它们。
DIGIT = re.compile("([" + OPTIONS + "])")
RUNTIME = "NLLB-200 distilled 600M / CTranslate2 4.9.0 / 韩文官解本机机译"
HY_RUNTIME = "HY-MT1.5-1.8B Q6_K / llama.cpp / 韩文官解本机机译"
HY_HASH = "c3819200ab9a79cb29b9a05ce8920e2eb01ae7ce520094fc5b57356494f3c641"
GLOSSARY = {
    "비보호좌회전":"无保护左转","일시정지":"暂时停车","서행":"慢行",
    "등화":"灯光信号","회전교차로":"环形交叉口","어린이 보호구역":"儿童保护区",
    "어린이통학버스":"儿童校车","횡단보도":"人行横道","정지선":"停止线",
    "도로교통법 시행규칙":"《道路交通法施行规则》","도로교통법 시행령":"《道路交通法施行令》",
    "차로":"车道","앞지르기":"超车","운전면허증":"驾驶证","방향지시기":"转向灯",
    "범칙금":"违章罚款（범칙금）","과태료":"行政罚款（과태료）","벌금":"刑事罚金",
    "노면전차":"有轨电车","개인형 이동장치":"个人代步工具","혈중알코올농도":"血液酒精浓度",
    "보행자":"行人","가장자리":"边缘","진로변경":"变道","긴급자동차":"紧急车辆",
}

def checksum(data):
    return hashlib.sha256(data.encode("utf-8")).hexdigest()

def digest_shape(*data):
    return hashlib.sha256(json.dumps(list(data),ensure_ascii=False,separators=(",",":")).encode()).hexdigest()

def valid_question(bank,q,source):
    h=digest_shape(q["question_id"],q["question_type"],q["prompt_zh"],
                   [[x["id"],x["text"]] for x in q["options"]],q["correct_answers"],
                   q.get("evidence",{}).get("page"),q["media_kind"])
    if h!=source["questions"].get(q["question_id"],[None])[0]:
        raise ValueError(f"{bank['bank_version']} 第 {q['question_id']} 题与官方题文指纹不同")
    raw=q.get("official_explanation_ko","").strip()
    if raw and digest_shape(raw,q.get("evidence",{}).get("ko_page"))!=source["questions"][q["question_id"]][2]:
        raise ValueError(f"{bank['bank_version']} 第 {q['question_id']} 题的韩文解析指纹不同")
    return h,raw

def unit_rows(raw,sp):
    current=""
    result=[]
    for sentence in SENTENCE.split(raw):
        sentence=sentence.strip()
        if not sentence:
            continue
        # 每个选项段落独立，方便把官方理由配回原选项。
        marked=sentence[0] in OPTIONS
        if (marked or len(sp.encode(current+" "+sentence))>135) and current:
            result.append(current)
            current=""
        current=(current+" "+sentence).strip()
    if current:
        result.append(current)
    bounded=[]
    for part in result:
        ids=sp.encode(part)
        if len(ids)<=200:
            bounded.append(part)
            continue
        for i in range(0,len(ids),150):
            bounded.append(sp.decode(ids[i:i+150]))
    return bounded

def clean_input(text):
    # 去掉 OCR 软连字符和重复空格，保留原文单位、标点与否定。
    return re.sub(r"\s+"," ",unicodedata.normalize("NFC",text).replace("\u00ad","")).strip()

def tokens(sp,line):
    return ["kor_Hang", *sp.encode(line,out_type=str), "</s>"]

def protect_marker(unit):
    marker=unit[0] if unit and unit[0] in OPTIONS else ""
    return (marker,unit[1:].strip()) if marker else ("",unit)

def number_set(text):
    return {n.replace(",","") for n in FIGURES.findall(unicodedata.normalize("NFKC",text))}

def note_issues(ko,zh):
    todo=[]
    # 数值或单位可能换写（正确转换也标记），提示有据可比。
    if number_set(ko)!=number_set(zh):
        todo.append("数值写法需对照原文")
    if HANGUL.search(zh):
        plain=re.sub(r"[（(](?:범칙금|과태료)[）)]","",zh)
        if HANGUL.search(plain):
            todo.append("含未译韩文")
    if "⁇" in zh or "\ufffd" in zh or re.search(r"(.{2,12})\1{3,}",zh):
        todo.append("译文存在缺字或异常重复")
    source_neg=re.search(r"삼가|않[가-힣]*|아니|금지|할 수 없|하면 안|못한다|못하도록|하지 말",ko)
    if source_neg and not re.search(r"不|没|无|非|禁止|严禁|切勿|避免|免于|除外|不得|仅|只有",zh):
        todo.append("原文含禁止或例外，译文需确认")
    concepts=[
        (r"우\s*회\s*전",r"右转|右拐|向右|往右"),
        (r"좌\s*회\s*전",r"左转|左拐|向左|往左"),
        (r"일시\s*정지",r"停住|停车|停下|停驶|停止"),
        (r"타고\s*내리|승\s*[·ㆍ]?\s*하차|승차 및 하차",r"上下车|上车.{0,15}下车|乘车.{0,15}下车|上、下车"),
    ]
    if any(re.search(a,ko) and not re.search(b,zh) for a,b in concepts):
        todo.append("原文的具体动作需对照")
    if not re.search(r"[\u3400-\u9fff]",zh):
        todo.append("未提取到可用中文")
    if len(ko)>38 and len(zh)<len(ko)*.13:
        todo.append("译文偏短，请核对原文")
    return todo

class LocalHY:
    def __init__(self,args):
        self.args=args
        self.client=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.process=None
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0))
            port=sock.getsockname()[1]
        self.url=f"http://127.0.0.1:{port}"

    def __enter__(self):
        with self.args.gguf.open("rb") as src:
            if hashlib.file_digest(src,"sha256").hexdigest()!=HY_HASH:
                raise ValueError("混元模型指纹与记录不同")
        log=self.args.cache.parent/"llama-local.log"
        log.parent.mkdir(parents=True,exist_ok=True)
        with log.open("wb") as out:
            self.process=subprocess.Popen([str(self.args.llama_server.resolve()),"-m",str(self.args.gguf.resolve()),
                "--host","127.0.0.1","--port",self.url.rsplit(":",1)[1],"--n-gpu-layers","99",
                "-np",str(self.args.workers),"-c",str(self.args.workers*896),"-t","4","-tb","4",
                "-b","768","-ub","384","--no-webui","--no-warmup"],stdout=out,stderr=out,
                creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        try:
            for _ in range(150):
                if self.process.poll() is not None:
                    raise RuntimeError("本地推理进程提前结束，详情："+str(log))
                try:
                    with self.client.open(self.url+"/health",timeout=2) as health:
                        if health.status==200:
                            return self
                except OSError:
                    time.sleep(.4)
            raise RuntimeError("本地模型未在限时内载入，详情："+str(log))
        except BaseException:
            self.__exit__(None,None,None)
            raise

    def __exit__(self,*_):
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)

    def translate(self,line):
        glossary="；".join(a+"→"+b for a,b in GLOSSARY.items() if a in line)
        user=(("参考术语："+glossary+"。\n") if glossary else "")+(
          "将以下韩文翻译成自然的简体中文，保留数字、单位、否定和条件。"
          "只输出译文，不要额外解释：\n\n"+line)
        prompt="<｜hy_begin▁of▁sentence｜><｜hy_User｜>"+user+"<｜hy_Assistant｜>"
        request=urllib.request.Request(self.url+"/completion",data=json.dumps({
            "prompt":prompt,"n_predict":min(390,max(72,len(line)*2)),
            "temperature":0.15,"top_k":20,"top_p":0.65,"repeat_penalty":1.06,
            "cache_prompt":False,"stop":["<｜hy_end▁of▁sentence｜>","<｜hy_User｜>"],
        }).encode(),headers={"Content-Type":"application/json"})
        for i in range(3):
            try:
                with self.client.open(request,timeout=120) as res:
                    result=json.load(res)
                text=str(result["content"]).strip()
                if text:
                    return text
            except (OSError,KeyError,ValueError) as e:
                if i==2:
                    raise RuntimeError("本地翻译请求失败："+str(e)) from e
            time.sleep(.4)
        raise RuntimeError("本地模型未返回译文")

def run(args):
    import sentencepiece as spm

    use_hy=bool(args.llama_server)
    if use_hy!=bool(args.gguf):
        raise ValueError("--llama-server 与 --gguf 要同时提供")
    if not use_hy:
        import ctranslate2
        with (args.model/"model.bin").open("rb") as fp:
            if hashlib.file_digest(fp,"sha256").hexdigest()!=MODEL_HASH:
                raise ValueError("模型文件 SHA-256 与记录不符")
    manifest=json.loads(MANIFEST.read_text(encoding="utf-8"))
    manual={i for c in json.loads(TEACHING.read_text(encoding="utf-8")) for i in c["order"]}
    sp=spm.SentencePieceProcessor(model_file=str(args.model/"sentencepiece.bpe.model"))
    rows={}
    units={}
    verified={}
    for file in args.banks:
        bank=json.loads(file.read_text(encoding="utf-8"))
        ver=bank["bank_version"]
        source=manifest[ver]
        if (bank["attachment_sha256"],bank["source_url"])!=(source["attachment_sha256"],source["source_url"]):
            raise ValueError(f"{ver} 的官方原件指纹或链接不符")
        target={}
        rows[ver]=target
        for q in bank["questions"]:
            n=q["question_id"]
            if n in manual or not any(a<=int(n)<=b for a,b in source["ordinary_ranges"]):
                continue
            key,raw=valid_question(bank,q,source)
            segments=unit_rows(clean_input(raw),sp) if raw else []
            target[n]=(key,segments)
            for unit in segments:
                _, text=protect_marker(unit)
                if text:
                    units.setdefault(checksum(text),text)
        verified[ver]=len(target)
    cache={}
    if args.cache.exists():
        with args.cache.open(encoding="utf-8") as old:
            for line in old:
                try:
                    k,v=json.loads(line)
                    if k in units and isinstance(v,str):
                        cache[k]=v
                except ValueError:
                    # 中断只影响最后一行，下次会重译该句。
                    continue
    pending=[(k,v) for k,v in units.items() if k not in cache]
    # 按长度排批，减少填充和内存尖峰。
    pending.sort(key=lambda row:len(row[1]))
    if args.limit:
        pending=pending[:args.limit]
    total=len(pending)
    print("待翻译句段：",total,"；缓存：",len(cache),"；涉及：",verified,flush=True)
    if pending and use_hy:
        print("只在本机运行混元，题库不经过互联网。",flush=True)
        start=time.perf_counter()
        with LocalHY(args) as model, ThreadPoolExecutor(args.workers) as pool, args.cache.open("a",encoding="utf-8",newline="\n") as save:
            for i,((key,_),translated) in enumerate(zip(pending,pool.map(lambda kv:model.translate(kv[1]),pending),strict=True),1):
                cache[key]=translated
                save.write(json.dumps([key,translated],ensure_ascii=False,separators=(",",":"))+"\n")
                if i%20==0 or i==total:
                    save.flush()
                    print(f"已完成 {i}/{total}，耗时 {time.perf_counter()-start:.1f} 秒",flush=True)
    elif pending:
        device=args.device
        translator=None
        if device in ("auto","cuda") and ctranslate2.get_cuda_device_count():
            try:
                translator=ctranslate2.Translator(str(args.model),device="cuda",compute_type="int8_float16")
                # Windows 缺少 CUDA 用户态运行库时，在试译阶段回落。
                translator.translate_batch([tokens(sp,"자동차 운전")],target_prefix=[["zho_Hans"]],beam_size=1,max_decoding_length=16)
                device="cuda"
            except RuntimeError as e:
                print("显卡模式不可用，原因：",str(e).splitlines()[0],flush=True)
                if args.device=="cuda":
                    raise
                translator=None
        if translator is None:
            device="cpu"
            translator=ctranslate2.Translator(str(args.model),device="cpu",compute_type="int8",intra_threads=args.threads)
        print("本机翻译设备：",device,flush=True)
        args.cache.parent.mkdir(parents=True,exist_ok=True)
        batch=args.batch or (24 if device=="cuda" else 18)
        start=time.perf_counter()
        with args.cache.open("a",encoding="utf-8",newline="\n") as save:
            for cursor in range(0,total,batch):
                part=pending[cursor:cursor+batch]
                src=[tokens(sp,t) for _,t in part]
                results=translator.translate_batch(src,target_prefix=[["zho_Hans"]]*len(part),beam_size=1,
                     max_input_length=230,max_decoding_length=min(256,max(35,max(map(len,src))*2)))
                for (key,original),r in zip(part,results,strict=True):
                    out=r.hypotheses[0]
                    translated=sp.decode(out[1:] if out and out[0]=="zho_Hans" else out).strip()
                    if not translated:
                        translated=original
                    cache[key]=translated
                    save.write(json.dumps([key,translated],ensure_ascii=False,separators=(",",":"))+"\n")
                save.flush()
                done=cursor+len(part)
                if not cursor or (cursor//batch)%8==7 or done==total:
                    print(f"已完成 {done}/{total}，耗时 {time.perf_counter()-start:.1f} 秒",flush=True)
    output={"format":"kr-coaching-translation-v1","method":HY_RUNTIME if use_hy else RUNTIME,"banks":{}}
    for ver,block in rows.items():
        translated={}
        coverage={"translated":0,"source_missing":0,"needs_check":0,"pending":0}
        for n,(h,segments) in block.items():
            zh,issues,check_segments=[],set(),[]
            missing=False
            for unit in segments:
                marker,txt=protect_marker(unit)
                result=cache.get(checksum(txt)) if txt else ""
                if result is None:
                    missing=True
                    break
                zh.append((marker,result))
                if txt:
                    current=note_issues(txt,result)
                    if current:
                        check_segments.append(len(zh)-1)
                        issues.update(current)
            if missing:
                coverage["pending"]+=1
                continue
            coverage["translated" if segments else "source_missing"]+=1
            if issues:
                coverage["needs_check"]+=1
            translated[n]={"fingerprint":h,"translated":zh,"checks":sorted(issues),"check_segments":check_segments,"source":"ko" if segments else "none"}
        output["banks"][ver]=translated
        print(ver,coverage,flush=True)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    tmp=args.output.with_suffix(".tmp")
    tmp.write_text(json.dumps(output,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
    tmp.replace(args.output)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model",type=Path,required=True)
    p.add_argument("--cache",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--device",choices=["auto","cpu","cuda"],default="auto")
    p.add_argument("--threads",type=int,default=8)
    p.add_argument("--batch",type=int,default=0)
    p.add_argument("--limit",type=int,default=0)
    p.add_argument("--llama-server",type=Path)
    p.add_argument("--gguf",type=Path)
    p.add_argument("--workers",type=int,default=12)
    p.add_argument("banks",type=Path,nargs="+")
    run(p.parse_args())

if __name__=="__main__":
    try:
        main()
    except (OSError,ValueError,RuntimeError) as ex:
        print("生成中文解析失败："+str(ex),file=sys.stderr)
        sys.exit(1)
