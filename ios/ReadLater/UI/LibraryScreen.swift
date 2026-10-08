import SwiftUI
import SafariServices

/// 整个应用的主页面：阅读库。登录、保存方式等都在右上角"设置"里。
struct LibraryScreen: View {
    @EnvironmentObject var account: AccountModel
    @EnvironmentObject var library: LibraryModel
    @Environment(\.scenePhase) private var scenePhase

    @State private var showUnread = true
    @State private var query = ""
    @State private var showSettings = false
    @State private var showAdd = false
    @State private var safariURL: URL?
    @State private var path: [LibraryItem] = []

    private var visible: [LibraryItem] {
        library.items.filter { $0.isRead != showUnread && matches($0) }
    }

    private func matches(_ item: LibraryItem) -> Bool {
        query.isEmpty || [item.title, item.url, item.notes ?? ""].contains { $0.localizedCaseInsensitiveContains(query) }
    }

    /// 只有需要你处理时（同步出错、有改动没上传）才会在左上角出现云图标。
    private var needsAttention: Bool {
        if account.session == nil { return false }
        switch library.syncState {
        case .failed, .needsSignIn, .pending: return true
        default: return false
        }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if account.session == nil { signInPrompt } else if visible.isEmpty { emptyState }
                ForEach(visible) { item in
                    row(item)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { library.delete(item) } label: { Label("删除", systemImage: "trash") }
                        }
                        .swipeActions(edge: .leading) {
                            Button { library.setRead(item, read: !item.isRead) } label: {
                                Label(item.isRead ? "未读" : "已读", systemImage: item.isRead ? "circle" : "checkmark")
                            }.tint(.accentColor)
                        }
                }
            }
            .listStyle(.plain)
            .refreshable { await refresh() }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if needsAttention {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showSettings = true } label: { Image(systemName: "exclamationmark.icloud") }
                            .accessibilityLabel("同步需要处理")
                    }
                }
                ToolbarItem(placement: .principal) {
                    Picker("阅读状态", selection: $showUnread) {
                        Text(library.unreadCount > 0 ? "待读 \(library.unreadCount)" : "待读").tag(true)
                        Text("已读").tag(false)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 200)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button { showAdd = true } label: { Image(systemName: "plus") }.accessibilityLabel("添加链接")
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }.accessibilityLabel("设置")
                }
            }
            .searchable(text: $query, prompt: "搜索阅读库")
            .searchToolbarBehavior(.minimize)
            .navigationDestination(for: LibraryItem.self) { item in
                ReaderScreen(itemID: item.id, openOriginal: { safariURL = URL(string: $0) })
            }
        }
        .task { await refresh() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refresh() } }
        }
        .sheet(isPresented: $showSettings) { SettingsScreen().environmentObject(account).environmentObject(library) }
        .sheet(isPresented: $showAdd) { AddLinkScreen().environmentObject(account).environmentObject(library) }
        .sheet(item: $safariURL) { SafariView(url: $0).ignoresSafeArea() }
    }

    private func refresh() async {
        account.reload()
        await library.sync()
    }

    // MARK: 空状态

    private var signInPrompt: some View {
        VStack(spacing: 14) {
            Text("登录后，电脑和手机的阅读库会同步").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("登录阅读库") { showSettings = true }.buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 48)
        .listRowSeparator(.hidden)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text(query.isEmpty ? (showUnread ? "没有待读内容" : "读过的内容会留在这里") : "没有找到这篇内容").font(.headline)
            if query.isEmpty && showUnread {
                Text("在微信里复制文章链接，再点控制中心的按钮，就会出现在这里。")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 40).frame(maxWidth: .infinity).padding(.vertical, 48)
        .listRowSeparator(.hidden)
    }

    // MARK: 一行文章：方块 + 标题 + 来源 · 日期 · 时长 + 更多

    private func row(_ item: LibraryItem) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Button { open(item) } label: {
                HStack(alignment: .top, spacing: 12) {
                    Text(item.initial).font(.system(size: 11, weight: .semibold))
                        .frame(width: 28, height: 28)
                        .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color(.secondarySystemBackground)))
                        .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(Color(.separator).opacity(0.55), lineWidth: 1))
                        .padding(.top, 1)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title).font(.system(size: 16, weight: .medium)).lineSpacing(2)
                            .lineLimit(2).multilineTextAlignment(.leading)
                        Text(meta(item)).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Menu {
                Button { library.setRead(item, read: !item.isRead) } label: {
                    Label(item.isRead ? "标为未读" : "标为已读", systemImage: item.isRead ? "circle" : "checkmark")
                }
                Button { safariURL = URL(string: item.url) } label: { Label("打开原文", systemImage: "safari") }
                Button(role: .destructive) { library.delete(item) } label: { Label("删除", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 16)).foregroundStyle(.secondary)
                    .frame(width: 44, height: 32).contentShape(Rectangle())
            }
            .tint(.secondary)
        }
        .listRowInsets(EdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 8))
    }

    private func meta(_ item: LibraryItem) -> String {
        var parts = [item.siteName, DayLabel.text(for: item.savedDate)]
        parts.append(item.readingMinutes.map { "\($0) 分钟" } ?? "仅链接")
        if let progress = item.progress, progress > 0, !item.isRead { parts.append("\(Int(progress * 100))%") }
        return parts.joined(separator: " · ")
    }

    private func open(_ item: LibraryItem) {
        if item.articleText != nil {
            path.append(item)
        } else {
            safariURL = URL(string: item.url)
            if !item.isRead { library.setRead(item, read: true) }
        }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
