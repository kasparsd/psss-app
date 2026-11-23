import SwiftUI

/// The text of a help topic: a title, the sentences and at most one reviewed link. Two text sizes.
private struct HelpBubble: View {
    let topic: HelpTopic

    private func linkText(_ link: HelpTopic.Link) -> AttributedString {
        var text = AttributedString("\(link.title) ↗")
        text.link = link.url
        return text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: topic.title).font(.headline).frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: topic.text).font(.body).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let link = topic.link {
                // A link inside the text, not a `Link` control: a control in a popover is centred and indented by its button style.
                // As text it starts at the same leading edge as the sentences above. The accent colour is set explicitly, because a
                // popover opened from a button would otherwise draw the link grey.
                Text(linkText(link))
                    .font(.body)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .tint(Color.accentColor)
            }
        }
        .multilineTextAlignment(.leading)
        .padding(16)
        .frame(width: 300, alignment: .leading)
        #if os(iOS)
        // A bubble on iPhone too, not a sheet. Tap outside closes it.
        .presentationCompactAdaptation(.popover)
        #endif
    }
}

/// A system info button beside a term or line. It opens a popover with the topic's text; nothing on the screen moves. Tap outside or
/// Escape closes it. Explains only: what a person must know to act stays on the screen.
struct InfoButton: View {
    let topic: HelpTopic
    @State private var shown = false

    var body: some View {
        Button { shown = true } label: {
            Image(systemName: "info.circle")
                // A comfortable target without growing the row.
                .frame(minWidth: 28, minHeight: 28)
                .contentShape(.rect)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(topic.buttonLabel)
        .help(topic.buttonLabel)
        .popover(isPresented: $shown) { HelpBubble(topic: topic) }
    }
}

/// A row of Setup's Help section: the topic's name, opening the same bubble.
struct HelpRow: View {
    let topic: HelpTopic
    @State private var shown = false

    var body: some View {
        Button { shown = true } label: {
            HStack {
                Text(verbatim: topic.title)
                Spacer(minLength: 8)
                Image(systemName: "info.circle").foregroundStyle(.secondary).accessibilityHidden(true)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(topic.buttonLabel)
        .popover(isPresented: $shown) { HelpBubble(topic: topic) }
    }
}
