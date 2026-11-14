# 提示词改动前的真实输出（基线）

记录日期：2026-10-16
插件版本：0.1.2
用途：18:00 修改提示词模板后，拿同一类查询对照，判断改动是否真的产生了差异。

## 样本一：单词 knob（词元形式）

选中词：`knob`，来自一篇讲模块合成器的 PDF。

```
knob /nɒb/
[单词]

n. 旋钮；圆形把手 （通用；电子乐器/设备）

在本句中的含义：合成器面板上的旋钮，即用于连续调节音量、频率、包络等参数的旋转式控制元件
依据：与 sliders, switches, and buttons, LED lights, inputs or outputs, and wires 并列，列举模块合成器面板上的各类控件

词源：中古英语 knobbe，原指「圆块、瘤状突起」，与中古低地德语 knobbe（结节）同源；由「圆形凸起」引申为「旋钮」这一机械/电子控件义。

例句：
- Turning the cutoff knob on a modular synthesizer sweeps the filter's corner frequency in real time.
  转动模块合成器上的截止频率旋钮，可以实时扫过滤波器的转折频率。
- Unlike a switch, a knob affords continuous rather than discrete control over a parameter.
  与开关不同，旋钮提供的是对参数的连续控制，而非离散控制。

讲解：在电子乐器与音频设备语境中，knob 专指面板上的旋转式电位器（potentiometer）控件，用于连续调节参数，与 sliders（推子）、switches（开关）、buttons（按钮）构成一组界面控件术语。注意与 button（按键，离散/触发式）和 fader/slider（线性滑动）区分：knob 强调旋转、连续、无级调节。常见搭配有 turn/adjust a knob、knob twiddling（调侃电子音乐人反复拧旋钮的表演动作）。
```

### 这条样本已经证明可用的环节

- **上下文定位确实生效。** 「依据」一栏引用的是并列枚举 `sliders, switches, and buttons, LED lights, inputs or outputs, and wires`，这段文字只可能来自 PDF 原文，不是模型编的。
- **`register` 字段生效**，输出里带出了「通用；电子乐器/设备」。
- **例句贴合本文语境**，两条都是模块合成器场景，符合提示词里「必须贴合本文的学科语境」的要求。
- **词源不为空**，说明 `showEtymology` 打开时模型确实会填。
- **`copyText` 渲染正常**，字段顺序为 词条 → 类型 → 义项 → 语境义 → 词源 → 例句 → 讲解。

### 这条样本测不到的地方

`knob` 本身就是词元，没有屈折或派生形态。18:00 要补的「词形分析」要求（表层形式、词元、屈折与派生的区分、构词基）在这条样本上不会产生任何可见差异。

要判断这条改动是否生效，需要再取一条**屈折形式或派生词**的样本，例如同一段里的 `sliders`、`outputs`，或者 `twiddling`、`recognition` 这类。理想情况下选中一个明显不是词元的形式，看当前模板是否只给出词性而不提词元，改完之后是否补上。

## 本轮四项改动在这条样本上的可见性

| 改动 | 在这条样本上是否可见 |
|---|---|
| 补词形分析 | 测不到（见上） |
| 段落开关改为不拼进提示词 | 测不到（`showEtymology` 开着、例句 2 条，都没被关） |
| 补注入防护 | 测不到（输出风格不会有变化） |
| 语言指令挪到 system prompt 末尾 | 测不到 |

也就是说这条样本适合确认「改动没有把原有能力改坏」，不适合确认「改动带来了新东西」。后者要靠屈折形式的样本，以及把 `showEtymology` 关掉、`exampleCount` 设成 0 之后看模型还会不会输出那两个字段。
