"""同日韩文原件：按题号及印刷答案交叉核验，提取可折叠的官方解析。"""
import re

import pymupdf as pdf

HEAD = re.compile(r"^[ \t]*(\d{1,4})[.．][ \t]*", re.M)
KEY = re.compile(r"^[ \t]*■[ \t]*정답[ \t]*[:：][ \t]*(\d(?:[ \t]*[,，.][ \t]*\d)*)[ \t]*$", re.M)
WHY = re.compile(r"^[ \t]*■[ \t]*(?:해설[ \t]*[:：]?[ \t]*|(?=행정안전부 국민재난안전포털))", re.M)

def extract(content, expected):
    found = {}
    with pdf.open(stream=content,filetype="pdf") as doc:
        for p in doc:
            text=p.get_text()
            headers=list(HEAD.finditer(text))
            for i,h in enumerate(headers):
                n=int(h[1])
                block=text[h.end():headers[i+1].start() if i+1<len(headers) else len(text)]
                # 解析内也可能出现英文句号编号；答案必须在原题题块中。
                a=KEY.search(block)
                if not a or not 1<=n<=expected:
                    continue
                if n in found:
                    raise ValueError(f"韩文原件题号 {n} 重复")
                why=WHY.search(text,h.end()+a.end())
                explanation=""
                if why and why.start()<h.end()+len(block):
                    # 解析中的数字列表不作为下一题，跳到下一个带独立印刷答案的题块。
                    tail=len(text)
                    for j in range(i+1,len(headers)):
                        nxt=headers[j]
                        until=headers[j+1].start() if j+1<len(headers) else len(text)
                        if KEY.search(text,nxt.end(),until):
                            tail=nxt.start()
                            break
                    explanation=re.sub(r" +"," "," ".join(text[why.end():tail].split())).strip()
                found[n]=(sorted(re.findall(r"\d",a[1])),explanation,p.number+1,
                          re.sub(r"\s+","",block[:a.start()]))
    if set(found)!=set(range(1,expected+1)):
        missing=sorted(set(range(1,expected+1))-set(found))
        raise ValueError(f"韩文原件题号核对错误，缺 {missing}")
    return found
