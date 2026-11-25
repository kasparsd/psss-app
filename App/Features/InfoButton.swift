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

/// Left-to-right flow of subviews that wraps at the proposed width. Used by `InfoText`: every word is a subview, and the last word
/// is joined with the info button into one subview, so the button can never sit alone on a line.
private struct WordFlow: Layout {
    var spacing: CGFloat = 4

    private func place(_ subviews: Subviews, width: CGFloat) -> (frames: [CGRect], size: CGSize) {
        var frames: [CGRect] = []
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += lineHeight; lineHeight = 0 }
            frames.append(CGRect(x: x, y: y, width: size.width, height: size.height))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (frames, CGSize(width: widest, height: y + lineHeight))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        place(subviews, width: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = place(subviews, width: bounds.width)
        for (subview, frame) in zip(subviews, result.frames) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: .unspecified)
        }
    }
}

/// A sentence that ends with its info button. The last word and the button wrap together (the equivalent of a non-breaking space
/// between them), so the button is never alone on a line. Spoken as the sentence followed by the button.
struct InfoText: View {
    let text: String
    let topic: HelpTopic

    var body: some View {
        let words = text.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        WordFlow {
            ForEach(Array(words.dropLast().enumerated()), id: \.offset) { _, word in Text(verbatim: word) }
            HStack(spacing: 0) {
                Text(verbatim: words.last ?? "")
                InfoButton(topic: topic)
            }
        }
        .accessibilityRepresentation {
            VStack { Text(verbatim: text); InfoButton(topic: topic) }
        }
    }
}
