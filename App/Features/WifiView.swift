import SwiftUI

/// Every saved Wi-Fi network, A to Z: icon, name, and the network's name with its security as the second line. A row opens the network's
/// page, which copies the password, shows a QR code and (iPhone and iPad) joins it. Where a selection is given (Mac and iPad at regular
/// width) the page shows beside the list.
struct WifiView: View {
    let items: [VaultItem]
    /// The selected network, in the split layouts. nil on iPhone, whose rows push the network's page.
    var selection: Binding<VaultItem.ID?>?
    let add: () -> Void

    private var networks: [VaultItem] {
        items.filter { $0.kind == .wifi }.sorted { $0.fullName.localizedStandardCompare($1.fullName) == .orderedAscending }
    }

    private var countText: String { networks.count == 1 ? String(localized: "1 network") : String(localized: "\(networks.count) networks") }

    var body: some View {
        let networks = networks
        Group {
            if let selection {
                List(selection: selection) { rows(networks) }
            } else {
                List { rows(networks) }
            }
        }
        .itemListStyle()
        .overlay {
            if networks.isEmpty {
                ContentUnavailableView {
                    Label("No Wi-Fi networks yet", systemImage: "wifi")
                } description: {
                    Text("Save the password of a network you share often. Psss keeps it with your other passwords and can show a QR code for a guest to join.")
                } actions: {
                    Button("Add network", action: add).buttonStyle(.borderedProminent)
                }
            }
        }
        .navigationTitle("Wi-Fi")
        #if os(iOS)
        .navigationSubtitle(selection == nil && !networks.isEmpty ? countText : "")
        #endif
        .columnTitleInList(selection != nil)
    }

    @ViewBuilder
    private func rows(_ networks: [VaultItem]) -> some View {
        if selection != nil { ListTitleLine(title: "Wi-Fi", count: countText) }
        ForEach(networks) { network in
            let content = ItemListRow(item: network, subtitle: Text(verbatim: network.wifiSecondLine)) { EmptyView() }
            let (first, last) = (networks.first?.id == network.id, networks.last?.id == network.id)
            if selection != nil {
                content.tag(network.id).itemRowInsets(first: first, last: last)
            } else {
                NavigationLink(value: network.id) { content }.itemRowInsets(first: first, last: last)
            }
        }
    }
}
