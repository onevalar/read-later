import SwiftUI

/// 设置：账号、保存方式（控制中心按钮）、手动保存。
struct SettingsScreen: View {
    @EnvironmentObject var account: AccountModel
    @EnvironmentObject var library: LibraryModel
    @Environment(\.dismiss) private var dismiss
    @State private var result = ""

    var body: some View {
        NavigationStack {
            Form {
                if account.session == nil { signIn } else { accountSection }
                saveMethods
                if account.session != nil { manualPaste }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
    }

    private var signIn: some View {
        Section {
            TextField("阅读库邮箱", text: $account.email)
                .textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField("密码", text: $account.password).textContentType(.password)
            Button(account.busy ? "正在登录…" : "登录并同步") {
                Task { if await account.signIn() { await library.sync() } }
            }
            .disabled(account.busy || account.email.isEmpty || account.password.isEmpty)
            if !account.error.isEmpty { Text(account.error).foregroundStyle(.red).font(.footnote) }
        } header: {
            Text("登录阅读库")
        } footer: {
            Text("使用和电脑插件、网页相同的账号。登录后，电脑和手机的内容会互相同步。")
        }
    }

    private var accountSection: some View {
        Section("账号") {
            LabeledContent("已登录", value: account.session?.email ?? "")
            LabeledContent("同步状态", value: library.syncState.label.isEmpty ? "已同步" : library.syncState.label)
            Button("立即同步") { Task { await library.sync() } }
            Button("退出登录", role: .destructive) {
                account.signOut()
                library.signedOut()
            }
        }
    }

    private var saveMethods: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                step(1, "打开“快捷指令”，新建一个快捷指令")
                step(2, "添加动作“保存到 Read Later”，把“内容”设为“剪贴板”")
                step(3, "命名为“保存到 Read Later”")
                step(4, "回到主屏幕，下拉打开控制中心，点左上角“+”→“添加控制”→“快捷指令”，选择刚才的快捷指令")
            }
            .padding(.vertical, 4)
            Button("打开快捷指令") {
                if let url = URL(string: "shortcuts://create-shortcut") { UIApplication.shared.open(url) }
            }
        } header: {
            Text("在微信里一键保存")
        } footer: {
            Text("只需设置一次。之后在微信里：右上角“…”→复制链接→下拉控制中心点一下按钮，不用打开本应用。需要 iOS 18 或更高版本。")
        }
    }

    private var manualPaste: some View {
        Section {
            PasteButton(payloadType: String.self) { strings in
                Task {
                    let outcome = await account.save(text: strings.joined(separator: "\n"))
                    result = outcome.message
                    await library.sync()
                }
            }
            .disabled(account.busy)
            if account.busy { ProgressView() }
            if !result.isEmpty { Text(result).font(.footnote).foregroundStyle(.secondary) }
        } header: {
            Text("保存剪贴板里的链接")
        } footer: {
            Text("在应用里手动保存时使用。")
        }
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("\(number)").font(.footnote.bold()).frame(width: 20, height: 20)
                .background(Circle().fill(Color.accentColor.opacity(0.15)))
            Text(text).font(.subheadline)
        }
    }
}

/// 阅读库底部的"+"：粘贴或输入链接保存。
struct AddLinkScreen: View {
    @EnvironmentObject var account: AccountModel
    @EnvironmentObject var library: LibraryModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var result = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://", text: $text).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    PasteButton(payloadType: String.self) { strings in text = strings.joined(separator: "\n") }
                } footer: {
                    Text("粘贴或输入网页链接。")
                }
                Section {
                    Button(account.busy ? "正在保存…" : "保存到阅读库") {
                        Task {
                            let outcome = await account.save(text: text)
                            result = outcome.message
                            await library.sync()
                            if case .saved = outcome { dismiss() }
                        }
                    }
                    .disabled(account.busy || text.isEmpty || account.session == nil)
                    if account.session == nil { Text("请先在设置里登录").font(.footnote).foregroundStyle(.secondary) }
                    if !result.isEmpty { Text(result).font(.footnote).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("添加链接")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
