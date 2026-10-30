# 翻译

Outline 的本地化由社区贡献完成。Outline 用户界面中的文本默认是美式英语，我们非常感谢社区为把应用带到不同语言所付出的所有努力。

## 字符串外部化

一段字符串在能被翻译之前，必须先被"外部化"。这个过程会把源代码中的英文字符串包裹进一个函数中，从而在运行时根据用户的语言取出对应的译文。

我们使用 [react-i18next](https://react.i18next.com/) 进行外部化，它提供 [useTranslation](https://react.i18next.com/latest/usetranslation-hook) hook 和 [Trans](https://react.i18next.com/latest/trans-component) 组件来包裹英文文本。

如果你发现代码库中还有未外部化的英文字符串，欢迎提交 PR 把它们包裹起来。

## 翻译字符串

我们使用 [CrowdIn](https://translate.getoutline.com/) 来管理翻译流程。它会跟踪每种语言中还有哪些字符串待翻译，自动与代码库同步，并提供出色的编辑界面。

使用 CrowdIn 需要注册一个免费账号。加入项目后，你可以按以下步骤提供翻译：

1. 选择你想贡献（或投票）翻译的语言（在语言下方可以看到翻译进度）
   ![CrowdIn UI](https://i.imgur.com/AkbDY60.png)

2. 请选择你所选语言下的 translation.json 文件

3. 选中文件后，左侧会显示该版本对应的所有字符串。想优先显示未翻译的字符串，请点击搜索框旁边的筛选图标，选择 "All, Untranslated First"。英文字符串旁边的红色方块表示该字符串尚未翻译。要提供翻译，请在左侧选中一个字符串，在右侧文本框中输入目标语言的译文（单数和复数形式），然后点击保存按钮。一旦某个字符串已经有其他用户提交了翻译（字符串旁会显示绿色方块），你也可以对其他用户的翻译进行投票。除非审校人员批准了其他译文，否则得票最多的翻译会被采用。![Editor UI](https://i.imgur.com/pldZCRs.png)

## 审校

在有人提交翻译之后，审校人员可以批准该翻译并将其标记为可在 Outline 中使用。

如果你有兴趣成为审校人员，请联系 Outline CrowdIn 项目中的一位项目经理，或联系 [@tommoor](https://github.com/tommoor)。同样，如果你的语言不在 CrowdIn 的语言列表中，请联系我们的项目经理或[给我们发邮件](https://www.getoutline.com/contact)，我们会把你的语言加进去。

## 发布

更新后的翻译会由 bot 自动向代码库发起 PR，并被定期合并，这样新的翻译就会出现在下一个 Outline 版本中。
