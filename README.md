# 韩驾学科 · 韩国驾照中文离线刷题

用韩国道路交通公团（한국도로교통공단，KoROAD）发布的中文学科考试题库练习。下载后无需账号、ChatGPT 订阅、网络 API 或远程服务器。所有练习、组卷和记录都在本机运行。

- **私人版**：如果已经拿到含两版题库的私人 ZIP，解压后直接打开 `index.html`；不需要安装开发工具或再导入。视频素材也在完整版内。
- **公开版**：下载本仓库根目录 [index.html](index.html)，保存到本机再打开。规则对照可直接使用；官方题文、解析原文及媒体没有放进公开文件。按下文从官网下载并转换后，在「数据管理 → 导入题库」选择 JSON。
- **ZIP 不可直接运行**。解压到固定文件夹后再打开，升级前先导出备份。

## 在设备上打开

| 设备 | 打开办法 | 注意 |
| --- | --- | --- |
| Windows 11 | 在资源管理器双击解压后的 `index.html`，或右键选择 Edge / Chrome | 推荐固定文件路径和浏览器。移动文件、换浏览器或清除数据前先备份 |
| 小米 Android | 从文件管理器打开已下载的 `index.html`，选择 Chrome；若只预览静态文件，可把文件放进 Download 并尝试在 Chrome 打开 `file:///sdcard/Download/index.html` | 是否可选 Chrome 取决于 HyperOS、文件管理器与浏览器版本；先答一题，再关页重开确认进度保留。若完整版加载困难，用轻量版 |
| iPad mini 7 | 在「文件」应用中，给 [a-Shell](https://apps.apple.com/us/app/a-shell/id1473805438) 的「在我的 iPad」目录新建文件夹 `quiz`，把 `index.html` 和 [ipad-local.py](tools/ipad-local.py) 放在一起。打开 a-Shell，运行 `cd ~/Documents/quiz` 与 `python3 ipad-local.py`；在 Safari 打开 `http://127.0.0.1:8787/` | 「文件」内建快速预览不能作为完整浏览器。辅助程序只读取本机这一个 HTML，只绑定回环地址，不连接互联网、不开放给其他设备。若切到 Safari 后 a-Shell 被挂起，可把两者同时放在屏幕上，再刷新 Safari。以后保持用同一个地址 |

在「数据管理」导出**完整备份**可迁移题库、收藏、统计、错题和模拟记录；**轻量备份**只含学习记录，目标设备先导入相同版本和内容。恢复会替换当地已有的学习记录。请把备份另存到系统文件夹或其他设备，IndexedDB、localStorage 都可能被浏览器清理。如果设备无法持久写入，页面会提示在关闭前导出。

如果浏览器无法播放自带视频，可取消「模拟包含视频题」，或用轻量版练习。

## 练习与考试

顺序练、随机练、历史错题、收藏、到期复习、考前集中复习均可按主题、素材、核验状态和易错点筛选。提交后显示中文公布答案、可关联的中文考点，以及有对应证据的韩文官方解析原文。错题约 10 分钟后到期；连续答对按 1、3、7、14、30、60 天延长间隔，反复答错优先。

[KoROAD 考试说明](https://www.safedriving.or.kr/dtGuide/selectDtGuide08.do?menuCd=MN-PO-1114)规定从题库出题，共 40 题、40 分钟；一类普通（1종 보통）70 分、二类普通（2종 보통）60 分合格。应用自行随机抽取 40 道通过校验且资料齐全的题，有可用视频时放一道；11 月版末尾 15 道大型、特殊车专项只开放练习。这是应用的组卷方案：未查到官方的完整抽题配比和逐题分值，结果只显示**答对、答错、未答**，不发百分制或合格判定。到时间自动交卷，离开再回来按绝对截止时间继续或补交。作答期间不显示答案。

2026 年 3 月 9 日和 11 月 30 日是两个独立版本。11 月版在韩国时间 11 月 30 日前仅能预习。可明确选择已过时的版本用于回顾。答案与进度不跨版，换版不会覆盖原有记录。

## 从官方附件在本机生成题库

在 Windows PowerShell 中运行（Python 3.12+；Node.js 22+ 只用于开发和打包）：

```powershell
py -m pip install -r tools/requirements.txt
py tools/convert.py --version 2026-03-09 --download --download-korean
py tools/convert.py --version 2026-11-30 --download --download-korean
```

脚本核对附件 SHA-256，将两个 `.bank.json` 保存到被 Git 忽略的 `private` 目录。也可在 [KoROAD 外语题库列表](https://www.safedriving.or.kr/subExamBoard/selectSubExamBoardEngList.do) 手动下载「중국어 (1·2종)」附件，将 `--download` 换为 `--pdf "你的PDF路径"`，并用 `--ko-pdf "同版韩文PDF路径"` 附加官方韩文解析。如果只提供中文 PDF，中文题干、答案和图片正常导入。

如需视频，准备支持 libx264 的 FFmpeg。第一版转换时加入 `--download-videos --videos private/videos`，另一版可用 `--videos private/videos` 复用已下载素材。本项会从官网取 35 段，原件合计超过 1 GB；建议在电脑上处理。已有本地 H.264 MP4 时用 `--videos "MP4文件夹"`（文件名例如 `966.mp4`）。媒体若因不同 FFmpeg 编译版本转出不同字节，会标为「素材未核验」并从模拟排除，仍可自行练习。

导入完也可本地打包为自包含私人 HTML：

```powershell
node tools/build.cjs --bank private/2026-03-09.bank.json --bank private/2026-11-30.bank.json --output private/离线版/index.html
```

不能把个人生成的题库、私人 HTML、备份或官方媒体提交到公共仓库。当前没有查到允许公开再分发这两个附件及其图片视频的许可。项目代码使用 MIT 许可证，该许可证不覆盖 KoROAD 原件。可读[题库格式](docs/题库格式.md)和[原件版本及核验说明](docs/核验记录.md)。

## 换领还是新考

截至 2026 年 11 月 17 日，[韩国警察厅 2026-6 号公告](https://www.law.go.kr/LSW/admRulInfoR.do?admRulSeq=2100000277080)及 [KoROAD 认可国家明细](https://www.safedriving.or.kr/diGuide/selectDiGuide07Pop.do?focusId=domesticLicensBtn)未列入中国大陆，香港、澳门、台湾另列。通常持有效大陆正式汽车驾照换领二类普通，要做文件审查、体检和 40 道学科考试（可选中文），符合换领条件时免技能和道路驾驶考试。符合特定居留身份或家属条件可能免学科：A-1/A-2/A-3、D-7/D-8/D-9、E-1/E-3/E-4/E-7、F-4 及相应配偶、未满 19 岁未婚子女。是否受理还取决于发证国停留、何时取得驾照与在韩身份等条件；办理前按 [KoROAD 文件要求](https://www.safedriving.or.kr/diGuide/selectDiGuide05.do)、[中国驾照正副本与豁免提示](https://www.safedriving.or.kr/diGuide/selectDiGuide08.do?menuCd=MN-PO-1213)、[《道路交通法施行令》第 52 条](https://law.go.kr/LSW/lumLsLinkPop.do?chrClsCd=010202&lspttninfSeq=109888)向驾照考场确认。

## 构建和测试

```powershell
npm run build
npm test
npm install --no-save --package-lock=false playwright
npm run test:browser
```

浏览器测试默认使用本机 Edge，设置离线并检查没有 HTTP 请求。真实题库测试可指定 `$env:QUIZ_PRIVATE_HTML = "私人离线版的HTML路径"`。验证 iPad 辅助程序时，可启动本机版后设置 `QUIZ_BROWSER=webkit` 和 `QUIZ_PRIVATE_URL=http://127.0.0.1:8787/`；测试只允许回环网络请求。手机、平板视口仿真不等于实体设备测试。
