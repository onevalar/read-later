import AppIntents

/// 在快捷指令里出现的动作："把〔剪贴板〕保存到 Read Later"。
/// openAppWhenRun = false：在后台完成，不会把你从微信里带走。
struct SaveLinkIntent: AppIntent {
    static var title: LocalizedStringResource = "保存到 Read Later"
    static var description = IntentDescription("把文字里的网页链接保存到稍后阅读，不打开应用。通常在“内容”里选择“剪贴板”。")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "内容", description: "包含网页链接的文字，通常选择“剪贴板”")
    var text: String

    static var parameterSummary: some ParameterSummary {
        Summary("把 \(\.$text) 保存到 Read Later")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let outcome = await SaveLinkService().save(text: text)
        return .result(dialog: IntentDialog(stringLiteral: outcome.message))
    }
}

struct ReadLaterShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SaveLinkIntent(),
            phrases: ["用 \(.applicationName) 保存链接", "保存到 \(.applicationName)"],
            shortTitle: "保存链接",
            systemImageName: "bookmark"
        )
    }
}
