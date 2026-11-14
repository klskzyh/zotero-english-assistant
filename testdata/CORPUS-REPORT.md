# Zotero PDF 全文词频统计插件：测试语料数据报告

- 生成日期：2026-10-16
- 扫描对象：Zotero 全文缓存的 `.zotero-ft-cache` 文件
- 处理环境：Node.js v24.18.0
- 操作性质：只读。未修改、未移动、未删除 Zotero 目录下的任何文件

---

## 1. 扫描结果

### 1.1 检索范围与命中数量

| 检索位置 | 命中的 `.zotero-ft-cache` |
| --- | --- |
| `C:\Users\<用户名>\Zotero\storage`（递归深度 3） | **68** |
| `C:\Users\<用户名>\AppData\Roaming\Zotero\Zotero\Profiles\u040eo59.default\storage` | 0 |
| `C:\Users\<用户名>\AppData\Roaming\Zotero`（整棵树，不限深度） | 0 |
| `C:\Users\<用户名>\Documents\Zotero` | 目录不存在 |
| `D:\Zotero\storage` | 目录不存在 |

共 68 份，全部位于 `C:\Users\<用户名>\Zotero\storage\<8 位条目 ID>\.zotero-ft-cache`，深度都是 3，没有更深一层的缓存文件。

配置目录下的 `storage` 子目录确实存在，但内容是该 Profile 自己的浏览器存储：`default`、`permanent`、`temporary` 三个子目录加 `ls-archive.sqlite`，属于 indexeddb 与 devtools 缓存。Zotero 的附件存储目录是 `C:\Users\<用户名>\Zotero\storage`。

68 份缓存所在的目录里，每一份都有同级的 PDF，没有出现「有缓存无 PDF」的情况。

### 1.2 分类结果

| 类别 | 判定条件 | 数量 |
| --- | --- | --- |
| 英文候选 | `cjkRatio < 0.01` 且 `latinRatio > 0.5` | 9 |
| 中文候选 | `cjkRatio > 0.2` | 57 |
| 其它 | 两条都不满足 | 2 |

9 + 57 + 2 = 68，没有遗漏。`cjkRatio` 落在 0.01–0.2 区间的文件数为 0。

归入「其它」的 2 份缓存不含任何 Unicode 字母：

| 目录 | 字符数 | PDF 文件名 | PDF 字节 |
| --- | --- | --- | --- |
| `L4PA6DGI` | 299 | 梅西安 图伦加利拉交响曲Turangalila Symphony 全集总谱.pdf | 40,557,431 |
| `QL2SYMBI` | 56 | 里盖蒂 Lux Aeterna.pdf | 11,464,311 |

两份都来自扫描版乐谱。`L4PA6DGI` 的 299 个字符里有 99 个换页符，`QL2SYMBI` 的 56 个字符里有 18 个换页符，剩下的都是空白字符。

---

## 2. 全部候选明细

68 份，按字符数降序。缓存路径为完整绝对路径。

| # | 分组 | 缓存路径 | 字符数 | UTF-8 字节 | latinRatio | cjkRatio | letterRatio | PDF 文件名 | PDF 字节 |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 1 | 英文 | `C:\Users\<用户名>\Zotero\storage\LAGJIFXW\.zotero-ft-cache` | 602,939 | 615,967 | 0.7709 | 0.0000 | 0.7723 | Patteson - 2016 - Instruments for new music sound, technology, and modernism.pdf | 13,468,804 |
| 2 | 英文 | `C:\Users\<用户名>\Zotero\storage\DEXLIP9J\.zotero-ft-cache` | 313,092 | 317,523 | 0.7815 | 0.0000 | 0.7821 | De Souza - 2017 - Music at hand instruments, bodies, and cognition.pdf | 5,720,449 |
| 3 | 英文 | `C:\Users\<用户名>\Zotero\storage\N9S4JNGF\.zotero-ft-cache` | 263,108 | 265,953 | 0.7755 | 0.0000 | 0.7770 | Grout 等 - 2010 - A history of western music.pdf | 40,698,306 |
| 4 | 中文 | `C:\Users\<用户名>\Zotero\storage\6SCPLV63\.zotero-ft-cache` | 122,959 | 287,717 | 0.0000 | 0.6077 | 0.6077 | 鲁立 - 2014 - 谢尔西四首弦乐四重奏中的声音主义观及其实现.pdf | 44,421,231 |
| 5 | 中文 | `C:\Users\<用户名>\Zotero\storage\2TK7ERHW\.zotero-ft-cache` | 113,802 | 285,640 | 0.0000 | 0.6716 | 0.6716 | 张磊 - 2008 - 论支声及其在西方现代音乐中的应用.pdf | 31,774,753 |
| 6 | 英文 | `C:\Users\<用户名>\Zotero\storage\GBWDPI7P\.zotero-ft-cache` | 97,527 | 97,527 | 0.7569 | 0.0000 | 0.7569 | Kraus - Tonal Plan and Narrative Plot in Tchaikovsky's Symphony No. 5 in E Minor.pdf | 2,253,811 |
| 7 | 中文 | `C:\Users\<用户名>\Zotero\storage\ZKR33JXI\.zotero-ft-cache` | 94,355 | 233,996 | 0.0000 | 0.6628 | 0.6628 | 许志斌 - 2008 - 武满彻中期作品研究.pdf | 18,567,860 |
| 8 | 中文 | `C:\Users\<用户名>\Zotero\storage\4NL62TPP\.zotero-ft-cache` | 88,678 | 229,269 | 0.0420 | 0.7060 | 0.7501 | 朱玫玫 - 2019 - 论陈其钢音乐创作中对戏曲元素的运用——以两部协奏曲和两部管弦乐作品为例.pdf | 16,282,878 |
| 9 | 中文 | `C:\Users\<用户名>\Zotero\storage\HYANJGNR\.zotero-ft-cache` | 86,871 | 211,722 | 0.0000 | 0.6383 | 0.6383 | 卢璐 - 2007 - 高为杰现代音乐创作技法研究.pdf | 26,437,905 |
| 10 | 英文 | `C:\Users\<用户名>\Zotero\storage\3X9MUFWQ\.zotero-ft-cache` | 72,439 | 73,584 | 0.7800 | 0.0000 | 0.7805 | De Souza - 2024 - Modular Synthesizers as Conceptual Models.pdf | 1,173,446 |
| 11 | 中文 | `C:\Users\<用户名>\Zotero\storage\MKUJDR77\.zotero-ft-cache` | 71,106 | 174,934 | 0.0000 | 0.6640 | 0.6640 | 王明 - 2010 - 乔治·利盖蒂《气氛》的音色—织体结构研究.pdf | 19,183,942 |
| 12 | 中文 | `C:\Users\<用户名>\Zotero\storage\2RTTVF64\.zotero-ft-cache` | 68,175 | 167,853 | 0.0000 | 0.6561 | 0.6561 | 梅西安最后六部管弦乐作品的创作技法研究_汪胜付.pdf | 48,211,052 |
| 13 | 英文 | `C:\Users\<用户名>\Zotero\storage\SQETLGT4\.zotero-ft-cache` | 55,962 | 56,580 | 0.7785 | 0.0000 | 0.7787 | Burnham - 2007 - Novel symphonies and dramatic overtures.pdf | 1,348,259 |
| 14 | 英文 | `C:\Users\<用户名>\Zotero\storage\ZZW4AMM4\.zotero-ft-cache` | 55,437 | 55,966 | 0.7872 | 0.0000 | 0.7873 | Seaton - 2004 - Symphony and overture.pdf | 1,791,186 |
| 15 | 英文 | `C:\Users\<用户名>\Zotero\storage\U9ZC8YLE\.zotero-ft-cache` | 49,615 | 49,994 | 0.7896 | 0.0000 | 0.7897 | Schroeder - 2005 - Orchestral music symphonies and concertos.pdf | 405,629 |
| 16 | 中文 | `C:\Users\<用户名>\Zotero\storage\QUKXJRKN\.zotero-ft-cache` | 36,387 | 93,139 | 0.0000 | 0.7023 | 0.7023 | 王尚 - 2011 - 陈其钢管弦乐组曲《五行》研究.pdf | 5,891,488 |
| 17 | 中文 | `C:\Users\<用户名>\Zotero\storage\P3X2B6ZW\.zotero-ft-cache` | 30,974 | 71,528 | 0.0004 | 0.6162 | 0.6166 | 陈鸿铎 - 2005 - 利盖蒂的结构思维特征、表现形式及其意义.pdf | 1,549,789 |
| 18 | 中文 | `C:\Users\<用户名>\Zotero\storage\AC77G4XB\.zotero-ft-cache` | 30,142 | 67,008 | 0.0002 | 0.5735 | 0.5738 | 桑桐 - 1982 - 多调性处理手法简介.pdf | 1,622,042 |
| 19 | 中文 | `C:\Users\<用户名>\Zotero\storage\5JJW3HH2\.zotero-ft-cache` | 28,420 | 53,880 | 0.0424 | 0.3649 | 0.4073 | 温德青“瞬变作曲法”探析——以《痕迹之Ⅳ》与《泼墨Ⅱ》为例_叶檬.pdf | 2,252,113 |
| 20 | 中文 | `C:\Users\<用户名>\Zotero\storage\C8BQ37B8\.zotero-ft-cache` | 26,485 | 64,626 | 0.0506 | 0.6790 | 0.7296 | 克里斯多弗·潘德列斯基《第一交响乐》创作研究_谢鹏.pdf | 24,863,038 |
| 21 | 中文 | `C:\Users\<用户名>\Zotero\storage\TM4PTHEN\.zotero-ft-cache` | 24,092 | 50,207 | 0.1461 | 0.5017 | 0.6479 | 钱仁平和马琳 - 2019 - 中国新音乐人工调式的理论与实践.pdf | 1,775,682 |
| 22 | 中文 | `C:\Users\<用户名>\Zotero\storage\B69IH9BK\.zotero-ft-cache` | 23,201 | 60,242 | 0.0851 | 0.7278 | 0.8132 | 鲁立 - 2014 - 谢尔西“单一音”技法在《第二弦乐四重奏》中的结构功能作用.pdf | 4,055,415 |
| 23 | 中文 | `C:\Users\<用户名>\Zotero\storage\CF2ML58F\.zotero-ft-cache` | 23,162 | 47,332 | 0.2642 | 0.4535 | 0.7180 | 刘鹏和刘洋 - 2023 - 欧美音乐理论前沿动态述评——以《音乐理论期刊》《音乐分析》《音乐理论纵览》为例.pdf | 1,530,599 |
| 24 | 中文 | `C:\Users\<用户名>\Zotero\storage\9VT3UR68\.zotero-ft-cache` | 22,390 | 56,399 | 0.0156 | 0.6282 | 0.6443 | 王姿肖 等 - 2024 - 六部音乐会作品探究.pdf | 4,761,067 |
| 25 | 中文 | `C:\Users\<用户名>\Zotero\storage\G2Y4HZ5Z\.zotero-ft-cache` | 21,559 | 50,757 | 0.1502 | 0.5811 | 0.7336 | 瞿枫 - 2023 - “主调”（Homophony）的误译与误释.pdf | 2,857,350 |
| 26 | 中文 | `C:\Users\<用户名>\Zotero\storage\YW5G5QEJ\.zotero-ft-cache` | 21,554 | 55,520 | 0.0301 | 0.6873 | 0.7174 | 韩锺恩 - 2023 - 之于特里斯坦和弦集释的别解.pdf | 4,579,886 |
| 27 | 英文 | `C:\Users\<用户名>\Zotero\storage\Q9ZWTHDN\.zotero-ft-cache` | 20,882 | 21,086 | 0.7904 | 0.0000 | 0.7904 | howtoread.pdf | 318,425 |
| 28 | 中文 | `C:\Users\<用户名>\Zotero\storage\E447ZWIZ\.zotero-ft-cache` | 20,569 | 49,829 | 0.0058 | 0.6237 | 0.6294 | 禇历 - 2011 - 十番锣鼓的数列结构.pdf | 1,473,330 |
| 29 | 中文 | `C:\Users\<用户名>\Zotero\storage\SAKKDECD\.zotero-ft-cache` | 19,577 | 44,421 | 0.0633 | 0.5241 | 0.5874 | 徐悦栋和姜之国 - 2023 - 十二音不变对称序列结构的图像研究与实际应用.pdf | 11,867,793 |
| 30 | 中文 | `C:\Users\<用户名>\Zotero\storage\IHFQCNM5\.zotero-ft-cache` | 19,537 | 45,661 | 0.1101 | 0.5867 | 0.6968 | 贾瑶 - 2011 - 高平《钢琴协奏曲》中支声手法研究.pdf | 6,909,843 |
| 31 | 中文 | `C:\Users\<用户名>\Zotero\storage\PAT4ZH7C\.zotero-ft-cache` | 19,167 | 44,744 | 0.1488 | 0.5669 | 0.7171 | 奥利弗·梅西安 等 - 2016 - 梅西安《〈图伦加利拉交响曲〉分析》加美兰、“节奏角色”与鸟歌.pdf | 7,979,688 |
| 32 | 中文 | `C:\Users\<用户名>\Zotero\storage\3S9PYDF4\.zotero-ft-cache` | 18,948 | 42,435 | 0.0006 | 0.5421 | 0.5427 | 袁静芳 - 1983 - 民间锣鼓乐结构探微——对《十番锣鼓》中锣鼓乐的分析研究.pdf | 953,127 |
| 33 | 中文 | `C:\Users\<用户名>\Zotero\storage\Z28GF93D\.zotero-ft-cache` | 18,335 | 40,911 | 0.0000 | 0.5021 | 0.5021 | 樊祖荫 - 1987 - 论《十番锣鼓》中的节奏、音色序列与当代音乐创作的关系.pdf | 1,079,573 |
| 34 | 中文 | `C:\Users\<用户名>\Zotero\storage\F7WLPJ35\.zotero-ft-cache` | 15,213 | 42,341 | 0.0001 | 0.8089 | 0.8090 | 林 - 2024 - 中国当代器乐作品创作的理论思考.pdf | 1,679,562 |
| 35 | 中文 | `C:\Users\<用户名>\Zotero\storage\LI3W5Z5D\.zotero-ft-cache` | 14,944 | 32,135 | 0.0007 | 0.4748 | 0.4755 | 郑英烈 - 1990 - 威伯恩的技法特征——兼论其继承性及超前性.pdf | 895,658 |
| 36 | 中文 | `C:\Users\<用户名>\Zotero\storage\3F5PDEEA\.zotero-ft-cache` | 14,592 | 33,530 | 0.0008 | 0.5843 | 0.5850 | 张伯瑜 - 1991 - 中国锣鼓乐的节奏构成.pdf | 755,583 |
| 37 | 中文 | `C:\Users\<用户名>\Zotero\storage\CPDMZ6JR\.zotero-ft-cache` | 14,572 | 34,596 | 0.0000 | 0.6376 | 0.6376 | B.霍洛波娃 和 戴明瑜 - 1991 - 二十世纪音乐的节奏问题.pdf | 751,197 |
| 38 | 中文 | `C:\Users\<用户名>\Zotero\storage\7YBT5SBW\.zotero-ft-cache` | 14,422 | 31,215 | 0.0008 | 0.5249 | 0.5257 | 高为杰 - 1995 - 论音阶的构成及分类编目.pdf | 788,794 |
| 39 | 中文 | `C:\Users\<用户名>\Zotero\storage\6CJ3RBBQ\.zotero-ft-cache` | 14,310 | 35,360 | 0.1175 | 0.6664 | 0.7842 | 程薇瑾和王赟 - 2023 - 理性与感性的纠缠——基于音乐的韦伯和齐美尔知识社会学比较.pdf | 1,389,237 |
| 40 | 中文 | `C:\Users\<用户名>\Zotero\storage\HAD73YYZ\.zotero-ft-cache` | 13,951 | 38,031 | 0.0513 | 0.8026 | 0.8543 | 陈鸿铎 - 2003 - 利盖蒂微复调写作技法初探.pdf | 909,743 |
| 41 | 中文 | `C:\Users\<用户名>\Zotero\storage\KZCPIJ7M\.zotero-ft-cache` | 13,294 | 30,884 | 0.1282 | 0.5547 | 0.6844 | 冶鸿德 - 2023 - 回归还是创新？——布列兹《赞美诗Ⅰ》的作曲技法与艺术观念.pdf | 4,080,075 |
| 42 | 中文 | `C:\Users\<用户名>\Zotero\storage\H7LXGG7M\.zotero-ft-cache` | 13,084 | 34,696 | 0.0098 | 0.7101 | 0.7199 | 娄文利 - 2009 - 单声思维控制下的音响结构——郭文景歌剧《夜宴》音响结构技术特点.pdf | 2,259,394 |
| 43 | 中文 | `C:\Users\<用户名>\Zotero\storage\ISFJNNV8\.zotero-ft-cache` | 13,021 | 25,427 | 0.0002 | 0.4149 | 0.4151 | 罗忠镕先生音乐创作和理论研究学术贡献略述_周湘林.pdf | 705,438 |
| 44 | 中文 | `C:\Users\<用户名>\Zotero\storage\7VWVN4G4\.zotero-ft-cache` | 12,891 | 34,296 | 0.0053 | 0.7767 | 0.7820 | 高为杰 - 2017 - 情与理的博弈.pdf | 2,140,191 |
| 45 | 中文 | `C:\Users\<用户名>\Zotero\storage\YD8M69UC\.zotero-ft-cache` | 12,777 | 24,367 | 0.0773 | 0.4169 | 0.4942 | 昌英忠 - 2007 - 里盖蒂《为十三位演奏家而作室内协奏曲》音流透视.pdf | 538,754 |
| 46 | 中文 | `C:\Users\<用户名>\Zotero\storage\TTTI7W5W\.zotero-ft-cache` | 11,787 | 30,361 | 0.0798 | 0.6830 | 0.7631 | 郑中 - 2011 - 论梅西安音乐创作中的色彩理论.pdf | 477,394 |
| 47 | 中文 | `C:\Users\<用户名>\Zotero\storage\P3SWGIJN\.zotero-ft-cache` | 10,978 | 27,726 | 0.1137 | 0.6782 | 0.7919 | 徐昌俊 和 左延芳 - 2009 - 里盖蒂《永恒之光》中的微复调技法.pdf | 1,551,538 |
| 48 | 中文 | `C:\Users\<用户名>\Zotero\storage\KXXLF9TB\.zotero-ft-cache` | 10,948 | 23,210 | 0.0712 | 0.5394 | 0.6106 | 王茜 - 2006 - 论里盖蒂的微复调思维规律.pdf | 471,625 |
| 49 | 中文 | `C:\Users\<用户名>\Zotero\storage\IDI9PXFM\.zotero-ft-cache` | 10,822 | 29,023 | 0.0000 | 0.7403 | 0.7403 | 郑中 - 2008 - 奥利沃·梅西安1985年在京都的演讲.pdf | 234,444 |
| 50 | 中文 | `C:\Users\<用户名>\Zotero\storage\BTCQ37UC\.zotero-ft-cache` | 10,250 | 23,891 | 0.0000 | 0.6020 | 0.6020 | 樊祖荫 - 1983 - 论支声音乐.pdf | 532,604 |
| 51 | 中文 | `C:\Users\<用户名>\Zotero\storage\AWKKTKK8\.zotero-ft-cache` | 9,850 | 24,040 | 0.0592 | 0.6852 | 0.7444 | 姚恒璐 - 2008 - 三种音高思维的创作理念与实践——传统与现代作曲技法的共融.pdf | 3,093,623 |
| 52 | 中文 | `C:\Users\<用户名>\Zotero\storage\BRSGN4RV\.zotero-ft-cache` | 9,806 | 26,601 | 0.0304 | 0.7719 | 0.8023 | 刘健 - 2023 - 论音乐的“空间”问题.pdf | 1,221,491 |
| 53 | 中文 | `C:\Users\<用户名>\Zotero\storage\4SJSU5M8\.zotero-ft-cache` | 9,669 | 22,399 | 0.0000 | 0.5999 | 0.5999 | 鲁立 - 2014 - 从谢尔西“单一音”技法探其声音主义观.pdf | 622,910 |
| 54 | 中文 | `C:\Users\<用户名>\Zotero\storage\B3SD6YGZ\.zotero-ft-cache` | 9,463 | 19,496 | 0.0333 | 0.4674 | 0.5007 | 郑中 - 2004 - 梅西安色彩和弦表解析.pdf | 402,315 |
| 55 | 中文 | `C:\Users\<用户名>\Zotero\storage\5AQEETQC\.zotero-ft-cache` | 9,335 | 20,947 | 0.0000 | 0.5687 | 0.5687 | 陈其钢 - 1986 - 音乐大师梅西安.pdf | 608,783 |
| 56 | 中文 | `C:\Users\<用户名>\Zotero\storage\M3KCTIT6\.zotero-ft-cache` | 8,898 | 22,813 | 0.0734 | 0.7286 | 0.8020 | 印真 - 2002 - 新时期中国音乐创作中复调微观思维及微复调技法初探.pdf | 442,944 |
| 57 | 中文 | `C:\Users\<用户名>\Zotero\storage\ZVWRSRP4\.zotero-ft-cache` | 8,576 | 22,882 | 0.0280 | 0.7317 | 0.7597 | 李盼和董婷婷 - 2023 - “口语文化”视域下的流行音乐及其学科建设.pdf | 1,274,666 |
| 58 | 中文 | `C:\Users\<用户名>\Zotero\storage\UFS7BUD3\.zotero-ft-cache` | 8,453 | 23,179 | 0.0034 | 0.7938 | 0.7972 | 徐言亭 - 2023 - 艺术音乐中的文化身份研究——以秦文琛音乐中的“宽线条”组织建构为例.pdf | 2,354,371 |
| 59 | 中文 | `C:\Users\<用户名>\Zotero\storage\3PVFZPXB\.zotero-ft-cache` | 8,094 | 22,291 | 0.0009 | 0.7792 | 0.7801 | 钱庆利 - 2023 - 民族歌剧板腔体思维的本体缺陷及其解决之道.pdf | 1,448,099 |
| 60 | 中文 | `C:\Users\<用户名>\Zotero\storage\7N3T5ITZ\.zotero-ft-cache` | 6,652 | 15,667 | 0.0000 | 0.5995 | 0.5995 | 谢力昕 - 2006 - 里盖蒂的音符轨迹  杜法罗与里盖蒂的交谈(下).pdf | 785,495 |
| 61 | 中文 | `C:\Users\<用户名>\Zotero\storage\2KWEG43S\.zotero-ft-cache` | 5,993 | 14,364 | 0.0000 | 0.6179 | 0.6179 | 谢力昕 - 2006 - 里盖蒂的音符轨迹  杜法罗与里盖蒂的交谈(上).pdf | 478,483 |
| 62 | 中文 | `C:\Users\<用户名>\Zotero\storage\FR7PI2D2\.zotero-ft-cache` | 5,877 | 16,020 | 0.0330 | 0.8087 | 0.8418 | 高为杰 - 2010 - 跨一步  万紫千红——兼谈继承传统的收敛式思维与发散式思维.pdf | 386,145 |
| 63 | 中文 | `C:\Users\<用户名>\Zotero\storage\PEF6VMUQ\.zotero-ft-cache` | 5,101 | 12,951 | 0.0402 | 0.6891 | 0.7293 | 田刚 - 2006 - “非八度周期人工音阶”探析——以高为杰《韶Ⅱ》《路》《暮春》《雨思》为例.pdf | 423,457 |
| 64 | 中文 | `C:\Users\<用户名>\Zotero\storage\UG75AQHM\.zotero-ft-cache` | 4,582 | 10,984 | 0.1080 | 0.5746 | 0.6866 | 郑中 - 2009 - 梅西安的对称排列置换作曲技法.pdf | 1,087,156 |
| 65 | 中文 | `C:\Users\<用户名>\Zotero\storage\YKM3JBYQ\.zotero-ft-cache` | 3,438 | 8,659 | 0.0483 | 0.7039 | 0.7522 | 高为杰 - 2021 - 《焚琴》创作漫谈.pdf | 891,127 |
| 66 | 中文 | `C:\Users\<用户名>\Zotero\storage\WQ5884FH\.zotero-ft-cache` | 2,047 | 5,204 | 0.0640 | 0.6551 | 0.7191 | 单红龙 - 2006 - 山西威风锣鼓的节奏构成.pdf | 247,864 |
| 67 | 其它 | `C:\Users\<用户名>\Zotero\storage\L4PA6DGI\.zotero-ft-cache` | 299 | 299 | 0.0000 | 0.0000 | 0.0000 | 梅西安 图伦加利拉交响曲Turangalila Symphony 全集总谱.pdf | 40,557,431 |
| 68 | 其它 | `C:\Users\<用户名>\Zotero\storage\QL2SYMBI\.zotero-ft-cache` | 56 | 56 | 0.0000 | 0.0000 | 0.0000 | 里盖蒂 Lux Aeterna.pdf | 11,464,311 |

---

## 3. 最终选中的语料

| 语料文件 | 目录 | 字符数 | UTF-8 字节 | latinRatio | cjkRatio | letterRatio | PDF 字节 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `english-medium.txt` | `3X9MUFWQ` | 72,439 | 73,584 | 0.7800 | 0.0000 | 0.7805 | 1,173,446 |
| `english-long.txt` | `LAGJIFXW` | 602,939 | 615,967 | 0.7709 | 0.0000 | 0.7723 | 13,468,804 |
| `chinese.txt` | `6SCPLV63` | 122,959 | 287,717 | 0.0000 | 0.6077 | 0.6077 | 44,421,231 |

来源路径：

| 语料文件 | 源缓存路径 |
| --- | --- |
| `english-medium.txt` | `C:\Users\<用户名>\Zotero\storage\3X9MUFWQ\.zotero-ft-cache` |
| `english-long.txt` | `C:\Users\<用户名>\Zotero\storage\LAGJIFXW\.zotero-ft-cache` |
| `chinese.txt` | `C:\Users\<用户名>\Zotero\storage\6SCPLV63\.zotero-ft-cache` |

对应的文献：

| 语料文件 | PDF 文件名 |
| --- | --- |
| `english-medium.txt` | De Souza - 2024 - Modular Synthesizers as Conceptual Models.pdf |
| `english-long.txt` | Patteson - 2016 - Instruments for new music sound, technology, and modernism.pdf |
| `chinese.txt` | 鲁立 - 2014 - 谢尔西四首弦乐四重奏中的声音主义观及其实现.pdf |

中文档位按「`cjkRatio > 0.2` 中字符数最大」取到 `6SCPLV63`（122,959 字符）。第二大的 `2TK7ERHW` 是 113,802 字符。

### 3.1 未创建的文件

| 目标文件名 | 状态 | 原因 |
| --- | --- | --- |
| `english-short.txt` | 未创建 | 9 份英文候选里没有字符数落在 3000–20000 区间的文件。最小的一份是 `Q9ZWTHDN`（howtoread.pdf），20882 字符，比区间上限高 882 字符 |
| `latin-other.txt` | 未创建 | 全库没有法文或德文候选，见 3.3 |

英文中档（20000–120000）、英文长档（> 120000）、中文档都取到了。

### 3.2 英文中样本的选择依据

20000–120000 区间内共 6 份：

| 目录 | 字符数 | latinRatio | 重复行字符占比 | 词形平均长度 | 词种比 | PDF 文件名 |
| --- | --- | --- | --- | --- | --- | --- |
| `GBWDPI7P` | 97,527 | 0.7569 | 3.53% | 4.71 | 0.159 | Kraus - Tonal Plan and Narrative Plot in Tchaikovsky's Symphony No. 5 in E Minor.pdf |
| `3X9MUFWQ` | 72,439 | 0.7800 | 0.00% | 5.65 | 0.240 | De Souza - 2024 - Modular Synthesizers as Conceptual Models.pdf |
| `SQETLGT4` | 55,962 | 0.7785 | 13.36% | 5.19 | 0.244 | Burnham - 2007 - Novel symphonies and dramatic overtures.pdf |
| `ZZW4AMM4` | 55,437 | 0.7872 | 12.41% | 5.14 | 0.244 | Seaton - 2004 - Symphony and overture.pdf |
| `U9ZC8YLE` | 49,615 | 0.7896 | 5.90% | 5.12 | 0.255 | Schroeder - 2005 - Orchestral music symphonies and concertos.pdf |
| `Q9ZWTHDN` | 20,882 | 0.7904 | 1.63% | — | — | howtoread.pdf |

「重复行字符占比」的算法是：把全文按 LF 切开，去掉长度小于 12 的短行，凡同一行出现 5 次以上的，累加其字符数，再除以全文字符数。

选中 `3X9MUFWQ`（72,439 字符，0.00% 重复行）。区间内字符数最大的 `GBWDPI7P` 有 3.53% 的重复页脚（`This content downloaded from` 28 次），词形平均长度 4.71 偏低，正文夹着五线谱转出的 ASCII 噪声，末尾还有 OCR 断行。另外三份 Cambridge Companion 章节的逐页页眉页脚占 5.90%–13.36%，同一段 DOI 网址重复 19–25 次，会给词频统计带来大量重复串。

### 3.3 法文 / 德文候选：未找到

判定条件是 `latinRatio > 0.5` 且变音符密度较高。9 份英文候选里，含常见变音符字符（é è ê ë à â ä ô ö ü û ù î ï ç ñ ß 等 44 个）的词形统计：

| 目录 | 字符数 | 含变音符词形数 | 占比 |
| --- | --- | --- | --- |
| `LAGJIFXW` | 602,939 | 807 | 0.134% |
| `N9S4JNGF` | 263,108 | 118 | 0.045% |
| `3X9MUFWQ` | 72,439 | 38 | 0.052% |
| `DEXLIP9J` | 313,092 | 39 | 0.012% |
| `ZZW4AMM4` | 55,437 | 1 | 0.002% |
| `GBWDPI7P` / `SQETLGT4` / `U9ZC8YLE` / `Q9ZWTHDN` | — | 0 | 0.000% |

全库 68 份里没有一份的变音符密度超过 0.2%，最高的是 `LAGJIFXW` 的 0.134%。`LAGJIFXW` 的 776 个含变音符词形全部出自被引的德语书名与人名，频次最高的是 `für`(103)、`Jörg`(93)、`Musikblätter`(46)、`László`(23)、`Über`(21)、`Ästhetik`(14)、`Schünemann`(14)，正文语言是英文。因此判为「未找到」，不生成 `latin-other.txt`。

---

## 4. 截断检查（英文长样本 `english-long.txt`）

### 4.1 文件大小与比值

| 项 | 值 |
| --- | --- |
| PDF 文件名 | Patteson - 2016 - Instruments for new music sound, technology, and modernism.pdf |
| PDF 字节数 | 13,468,804 |
| 缓存字符数 | 602,939 |
| 缓存 UTF-8 字节数 | 615,967 |
| PDF 字节 ÷ 缓存字符 | **22.339** |
| 缓存字节 ÷ 缓存字符 | 1.022 |

作为对照，另外两份超过 120000 字符的英文候选：

| 目录 | 缓存字符数 | PDF 字节 | PDF 字节 ÷ 缓存字符 | 末字符 |
| --- | --- | --- | --- | --- |
| `DEXLIP9J` | 313,092 | 5,720,449 | 18.271 | `6` |
| `LAGJIFXW` | 602,939 | 13,468,804 | 22.339 | `.` |
| `N9S4JNGF` | 263,108 | 40,698,306 | 154.683 | `.` |

这个比值在英文候选内部就相差 8 倍以上（18.271 到 154.683），换成中文样本 `6SCPLV63` 是 361.269。它的高低主要由 PDF 里图片和扫描页的多少决定，不能跨文件当作截断判据。

### 4.2 末尾形态

- 最后一个字符是 `.`（ASCII 0x2E）。
- 末尾没有换行符，也没有悬空的连字符。
- 末尾 200 个字符（原样，含其中的真实换行）：

```
VERSITY OF CALIFORNIA PRESS www.ucpress.edu | www.luminosoa.org
Cover illustration: “Instrument für neue Musik.” Drawing dated 1914, reproduced in The Diaries of Paul Klee, 1898–1918 (UC Press, 1968).
```

这段是封底文字。`1898–1918` 用的是 U+2013 短破折号，`für` 用的是 U+00FC，弯引号用的是 U+201C / U+201D。内容在句号处完整收尾，没有半截词。

### 4.3 同档另一份的末尾异常

`DEXLIP9J` 的最后一个字符是 `6`，末尾 200 字符为：

```
b) mm. 34–45 (note return to the opening in the le hand, m. 42).
Downloaded from academic.oup.com/book/3754/chapter/145178594 by The Chinese University of Hong Kong, Shenzhen user on 14 September 2026
```

它是逐页重复的下载页脚，正文在页脚之前已经结束，末尾停在时间戳的秒位上。`le hand` 是 `left hand` 被 OCR 漏掉 `ft` 的结果。这一份的截断形态出现在页脚，`LAGJIFXW` 没有这个形态。

---

## 5. `.zotero-ft-cache` 格式特征

### 5.1 换行符

- 68/68 份只使用 LF（U+000A）。
- 含 CRLF 的文件数：0。
- 68/68 份都至少含一个 LF。

### 5.2 分页符

- 48/68 份含换页符 U+000C（`\f`），全库合计 1424 个。
- 每个 `\f` 前面都紧接 1 到 2 个空行：772 个前面是 `\n\n\n`，652 个前面是 `\n\n`。前面不是换行的裸 `\f` 有 0 个，出现在文件开头的有 0 个。
- 20 份不含 `\f`，全部是中文候选：`6SCPLV63`、`ZKR33JXI`、`4NL62TPP`、`MKUJDR77`、`2RTTVF64`、`B69IH9BK`、`PAT4ZH7C`、`LI3W5Z5D`、`CPDMZ6JR`、`7YBT5SBW`、`HAD73YYZ`、`TTTI7W5W`、`P3SWGIJN`、`IDI9PXFM`、`4SJSU5M8`、`B3SD6YGZ`、`5AQEETQC`、`7N3T5ITZ`、`2KWEG43S`、`UG75AQHM`。

`LAGJIFXW` 第 1 个 `\f`（偏移 77）前后，转义显示：

```
OUND, TECHNOLOGY, AND MODERNISM\nINSTRUMENTS\nFOR NEW MUSIC\n\n\n\fLuminos is the open access monograph publishing program fro
```

`2TK7ERHW` 第 1 个 `\f`（偏移 135）前后：

```
提交答辫时间 年 月\n修 改定稿时间 \n年 月\n\n\f上每房幸 李院\n学位论 文原创性声 明\n本人郑重声明 所呈交的学位论文是本人在导师的指导下独立进行研
```

### 5.3 汉字之间带空格

- 57/68 份含「汉字 + 半角空格 + 汉字」的形态。这个集合与 57 份中文候选完全重合，一一对应。
- 9 份英文候选和 2 份空白缓存都不含。
- 出现次数差别很大：最多 `6SCPLV63` 12728 处，其次 `MKUJDR77` 8120 处、`ZKR33JXI` 7049 处；最少 `FR7PI2D2` 只有 4 处。中文候选里没有一处都没有的文件。

空格落在词的内部，会把一个词切成两段。`6SCPLV63` 开头的实际片段：

```
上杂 身导\n\n学 校代 码\n\n学\n\n号\n\n：\n\n博 士 学位论文\n\n论文题 目\n\n《\n\n谢尔\n\n西\n\n四\n\n首\n\n弓玄\n\n乐\n\n四\n\n韋奏 ：
```

同一份文件里的一行：

```
作者姓名 鲁立\n学科专业\n\n音乐与 舞蹈 学 音乐学\n\n研究方 向\n\n外国作 曲家与作 品研究
```

`2TK7ERHW` 开头的片段：

```
学校代码\n学号 一\n上每 幸 李院\n博 士学位 论 文\n’\n论文题目 论束声及其在西方现代音乐\n中的应用
```

`6SCPLV63` 正文中段把词与标点拆到不同行的例子：

```
他认为 ，\n\n越来越 多 的 人开始关注 到 “ 深度 ”\n\n的\n\n存在 ，\n\n并对此进行研 究 。\n\n比 如在 乐 器制 造方面
```

### 5.4 行末断词（`informa-` 换行接 `tion`）

严格模式 `[A-Za-z]-\n[A-Za-z]` 只在 3 份文件里命中，共 4 处。3 份都是中文候选，4 处全部位于英文参考文献条目里：

| 目录 | 偏移 | 原样片段（`\n` 为真实换行） |
| --- | --- | --- |
| `CF2ML58F` | 9555 | `David Neumeyer, "Thematic Reading, Proto-\nbackgrounds, and Registral Transformations", Music Theory` |
| `CF2ML58F` | 17656 | `Richard Taruskin, "Catching Up with Rimsky-\nKorsakov", Music Theory Spectrum, Volume 33, Issue 2,` |
| `HAD73YYZ` | 13780 | `György LigetiJenseits von Avantgarde und Postmod-\nerne（《乔治 ·利盖蒂超越先锋派和后现代 派》）Verlag LafiteWien。` |
| `PAT4ZH7C` | 17389 | `－ Guide to the Chinese Edition of The Classical Style： Hay-\ndn，Mozart and Beethoven / YANG Yandi（ 6）` |

`HAD73YYZ` 那条把 `Postmoderne` 拆成 `Postmod-` 加 `erne`，`PAT4ZH7C` 那条把 `Haydn` 拆成 `Hay-` 加 `dn`。9 份英文候选里一处都没有，纯英文缓存正文中没有出现这类断词形态。

把条件放宽到「任意 `-` 紧跟换行」，另外 4 份文件命中，内容是五线谱或图表转成的 ASCII 噪声：

| 目录 | 命中数 | 原样片段（第一处） |
| --- | --- | --- |
| `GBWDPI7P` | 4 | `SUMMARY Dev. Recap.\nI (2)--\nL - - --\n\- ) N\n.00, b : \| - +:(#7) __5 ~ 111r,` |
| `YW5G5QEJ` | 2 | `增六和弦的和声动\n能，无论是意大利六和弦（Italy 6th ：ba-c-\n#f）` |
| `AC77G4XB` | 1 | `展 图式如下\n例 一- -一 \n”“\n-\n两 者 合 成 为 上列 一 七\n声调式。` |
| `9VT3UR68` | 1 | `■ ■\n3\n■■■ ■ ■ ■ ■ ■\n■ ### 44 - \n■ ■■ ■ ■\n-\n■ ■■■■` |

### 5.5 逐页重复的页眉页脚

重复行（同一行出现 5 次以上）占全文字符的比例，在 9 份英文候选里差别很大：

| 目录 | 字符数 | 重复行字符占比 | 重复行种类数 | 出现次数最高的重复行 |
| --- | ---: | ---: | ---: | --- |
| `LAGJIFXW` | 602,939 | 0.00% | 0 | （无） |
| `DEXLIP9J` | 313,092 | 4.87% | 12 | 30 次 `Downloaded from academic.oup.com/book/3754/chapter/145175471 by The Chinese University of Hong Kong, Shenzhen user on 14 September 2026` |
| `N9S4JNGF` | 263,108 | 0.08% | 1 | 6 次 `NAWM TEXT NO. COMPOSER AND TITLE PAGE` |
| `GBWDPI7P` | 97,527 | 3.53% | 2 | 28 次 `This content downloaded from` |
| `3X9MUFWQ` | 72,439 | 0.00% | 0 | （无） |
| `SQETLGT4` | 55,962 | 13.36% | 3 | 25 次 `Cambridge Companions Online © Cambridge University Press, 2011` |
| `ZZW4AMM4` | 55,437 | 12.41% | 3 | 23 次 `Cambridge Companions Online © Cambridge University Press, 2011` |
| `U9ZC8YLE` | 49,615 | 5.90% | 2 | 19 次 `Cambridge Companions Online © Cambridge University Press, 2011` |
| `Q9ZWTHDN` | 20,882 | 1.63% | 1 | 10 次 `Paul N. Edwards How to Read a Book` |

部分文件重复的是下载页脚，例如 `SQETLGT4` 里出现 25 次的 `Downloaded from https://www.cambridge.org/core. The Juilliard School, on 21 Dec 2021 at 11:48:33, subject to the Cambridge Core terms of use, available at`。`LAGJIFXW` 和 `3X9MUFWQ` 的重复行字符占比都是 0.00%。

---

## 6. 产出文件清单

| 文件 | 字节 | 来源 | SHA-256（与源文件比对结果） |
| --- | --- | --- | --- |
| `english-medium.txt` | 73,584 | `C:\Users\<用户名>\Zotero\storage\3X9MUFWQ\.zotero-ft-cache` | `d5c54f74e9d8390d0413e70f7b188436b3fd7f52b5920814080fbd51596361db` 一致 |
| `english-long.txt` | 615,967 | `C:\Users\<用户名>\Zotero\storage\LAGJIFXW\.zotero-ft-cache` | `de8a893cf43fdb66a1f7fc6cc354e098f7464646df5f738d4db9056e2ace8f22` 一致 |
| `chinese.txt` | 287,717 | `C:\Users\<用户名>\Zotero\storage\6SCPLV63\.zotero-ft-cache` | `90509059f885df37b76a1907ba9db961f7274f02682ff2c6243fbcbd2f1a388f` 一致 |
| `CORPUS-REPORT.md` | 本文件 | — | — |

3 个语料文件都用 `fs.copyFileSync` 逐字节复制，复制后重新计算 SHA-256 与源文件比对，字节数和哈希全部一致。过程中没有做编码转换、换行归一化或首尾裁剪。

---

## 7. 统计口径

- 字符数按 Unicode 码点计（JS 的 `[...text].length`）。68 份里只有 `7VWVN4G4` 的码点数（12891）与 UTF-16 长度（12892）差 1，原因是含 1 个代理对字符；其余 67 份两者相同。
- `latinRatio` = `[A-Za-z]` 码点数 ÷ 总码点数。
- `cjkRatio` = 码点落在 U+4E00–U+9FFF 的个数 ÷ 总码点数。
- `letterRatio` = `\p{L}` 匹配个数 ÷ 总码点数。
- 字节数取文件的原始大小（UTF-8）。
- 正则与 `\p{L}` 在 Node.js v24.18.0 下执行。
- 扫描、统计、复制全程未向 Zotero 目录写入任何内容。本报告与语料文件只写入 `C:\Users\<用户名>\Desktop\通用项目\zotero-wordfreq-2026-10-16\testdata\`。
