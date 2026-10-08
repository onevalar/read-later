import SwiftUI

@main
struct ReadLaterApp: App {
    @StateObject private var account = AccountModel()
    @StateObject private var library = LibraryModel()

    var body: some Scene {
        WindowGroup {
            LibraryScreen()
                .environmentObject(account)
                .environmentObject(library)
        }
    }
}
