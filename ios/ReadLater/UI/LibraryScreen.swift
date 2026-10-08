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

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                topBar
                List {
                    header
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
                .scrollContentBackground(.hidden)
                .refreshable { await refresh() }
            }
            .background(Color(.systemBackground))
            .toolbar(.hidden, for: .navigationBar)
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

    // MARK: 顶栏：品牌 + 添加 + 设置（不用系统导航栏，避免被系统按钮框挤压）

    private var topBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "bookmark").font(.system(size: 19, weight: .regular))
            Text("Read Later").font(.system(size: 17, weight: .semibold))
            Spacer()
            iconButton("plus", label: "添加链接") { showAdd = true }
            iconButton("slider.horizontal.3", label: "设置") { showSettings = true }
        }
        .padding(.leading, 20).padding(.trailing, 8)
        .frame(height: 48)
    }

    private func iconButton(_ name: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name).font(.system(size: 18)).foregroundStyle(.secondary)
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: 标题、同步状态、搜索、待读/已读

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 8) {
                Text("留给稍后的好内容").font(.system(size: 28, weight: .semibold)).tracking(-0.5)
                Button { syncTapped() } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "icloud").font(.system(size: 13))
                        Text(syncText).font(.system(size: 13))
                    }.foregroundStyle(.secondary)
                }.buttonStyle(.plain)
            }
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("搜索阅读库", text: $query).textInputAutocapitalization(.never).autocorrectionDisabled()
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(.secondarySystemBackground)))
            HStack(spacing: 8) {
                segment("待读 \(library.unreadCount)", selected: showUnread) { showUnread = true }
                segment("已读", selected: !showUnread) { showUnread = false }
            }
        }
        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 6)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }

    private func syncTapped() {
        if account.session == nil { showSettings = true; return }
        switch library.syncState {
        case .failed, .needsSignIn: showSettings = true
        default: Task { await library.sync() }
        }
    }

    private var syncText: String {
        if account.session == nil { return "登录后同步" }
        let label = library.syncState.label
        return label.isEmpty ? "已同步" : label
    }

    private func segment(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 15, weight: .medium)).frame(maxWidth: .infinity).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(selected ? Color.accentColor.opacity(0.13) : Color.clear))
                .foregroundStyle(selected ? Color.accentColor : Color.primary)
        }.buttonStyle(.plain)
    }

    // MARK: 空状态

    private var signInPrompt: some View {
        VStack(spacing: 14) {
            Text("登录后，电脑和手机的阅读库会同步").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("登录阅读库") { showSettings = true }.buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 48)
        .listRowInsets(EdgeInsets()).listRowSeparator(.hidden).listRowBackground(Color.clear)
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
        .listRowInsets(EdgeInsets()).listRowSeparator(.hidden).listRowBackground(Color.clear)
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
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title).font(.system(size: 16, weight: .medium)).lineSpacing(3)
                            .lineLimit(3).multilineTextAlignment(.leading)
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
        .padding(.leading, 20).padding(.trailing, 8).padding(.vertical, 16)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color(.separator).opacity(0.4)).frame(height: 1 / UIScreen.main.scale).padding(.horizontal, 20)
        }
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
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
