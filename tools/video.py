"""把 KoROAD 的媒体原件转成适合常见浏览器的 MP4。"""
import subprocess

def transcode(source,dest):
    # 大写 V 排除 ASF 内置的封面；原件有音轨时保留音轨。
    temporary=dest.with_suffix(".transcoding.mp4")
    try:
        subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-nostdin","-y","-threads","2",
          "-i",str(source),"-map","0:V:0","-map","0:a:0?","-vf","scale=864:-2:flags=lanczos",
          "-c:v","libx264","-pix_fmt","yuv420p","-preset","fast","-crf","27","-maxrate","820k",
          "-bufsize","1640k","-threads","2","-c:a","aac","-b:a","64k","-map_metadata","-1",
          "-movflags","+faststart",str(temporary)],check=True)
        temporary.replace(dest)
    finally:
        temporary.unlink(missing_ok=True)
