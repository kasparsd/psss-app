#if os(macOS) && DEBUG
import AppKit
import Carbon.HIToolbox
import SwiftUI

/// Prototype of the menu bar item (docs/plans/mac-menu-bar.md): a status item and ⌃⌘P open a panel that leaves the other app in
/// front. Debug builds only, and only with the launch argument `-psss-menu-bar` (the real vaults) or `-psss-menu-bar-sample` (the
/// compiled-in sample vault, nothing of the person's is touched).
///
/// `AppLock` locks for sleep, a locked screen and idle time and closes the vaults. The panel watches the same to close itself and
/// forget what it holds, and times its own absences.
@MainActor
final class MenuBarController: NSObject {
    static let shared = MenuBarController()
    static let panelSize = NSSize(width: 372, height: 580)
    /// The side margin of everything in the panel: that of the system's grouped forms.
    /// Also the space between the tabs and whatever a tab starts with: grouped forms bring this much themselves.
    static let inset: CGFloat = 20

    private var statusItem: NSStatusItem?
    private var panel: MenuBarPanelWindow?
    /// Where this opening put the panel; it goes back there when Keep on Top is turned off.
    private var home = NSPoint.zero
    private var model: MenuBarModel?
    private var hotKey: EventHotKeyRef?
    private var observers: [NSObjectProtocol] = []
    private var monitors: [Any] = []
    private var idleTimer: Task<Void, Never>?
    private var swiping = false
    /// Whether this scroll gesture's direction has been judged.
    private var scrollJudged = false

    func startIfRequested(session: VaultSession, gate: UnlockGate) {
        let arguments = ProcessInfo.processInfo.arguments
        let sample = arguments.contains("-psss-menu-bar-sample")
        guard statusItem == nil, sample || arguments.contains("-psss-menu-bar") else { return }
        let model = MenuBarModel(session: session, gate: gate, sample: sample ? SampleVaultStore() : nil)
        model.close = { [weak self] openingApp in self?.dismiss(openingApp: openingApp) }
        model.keptOnTopChanged = { [weak self] in self?.applyKeptOnTop() }
        self.model = model

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = Self.mark()
        item.button?.toolTip = "Psss"
        item.button?.setAccessibilityLabel("Psss")
        item.button?.target = self
        item.button?.action = #selector(toggleUnderItem)
        statusItem = item

        let panel = MenuBarPanelWindow(contentRect: NSRect(origin: .zero, size: Self.panelSize),
                                       styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.setAccessibilityLabel("Psss")
        // The system's glass is the panel's whole surface; it draws the edge, so there is no outline of our own.
        let glass = NSGlassEffectView(frame: NSRect(origin: .zero, size: Self.panelSize))
        glass.cornerRadius = 16
        glass.contentView = FirstClickHostingView(rootView: MenuBarPanelView(model: model))
        panel.contentView = glass
        // Escape from anywhere that does not use it itself: leave an item's page or a new item's form first, then close.
        panel.cancel = { [weak self] in
            guard let model = self?.model else { return }
            if model.tab == .search, model.opened != nil { model.back() }
            else if model.tab == .add, model.formOpen, model.store != nil { model.leaveForm() }
            else { self?.dismiss() }
        }
        self.panel = panel
        applyKeptOnTop()

        registerHotKey()
        watch(model)
    }

    /// The logo in its hidden state (the field, the p and the three dots), as a template image the system colours.
    private static func mark() -> NSImage {
        let box = LogoFieldGeometry.box
        // Lower than a square icon (about 16 pt): the field is more than twice as wide as it is high, so it reads heavy.
        let height: CGFloat = 13
        let scale = height / box.height
        let image = NSImage(size: NSSize(width: (box.width * scale).rounded(.up), height: height), flipped: true) { _ in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            context.scaleBy(x: scale, y: scale)
            context.translateBy(x: -box.minX, y: -box.minY)
            context.setFillColor(.black)
            context.setStrokeColor(.black)
            context.setLineJoin(.round)
            let outline = LogoFieldGeometry.outline
            context.setLineWidth(LogoFieldGeometry.line)
            context.addPath(CGPath(roundedRect: outline, cornerWidth: outline.height / 2, cornerHeight: outline.height / 2, transform: nil))
            context.strokePath()
            // The letter is the typeface's outline, filled and stroked to the icon's weight.
            context.setLineWidth(LogoFieldGeometry.letterStroke)
            context.addPath(LogoFieldGeometry.p.cgPath)
            context.drawPath(using: .fillStroke)
            context.addPath(LogoFieldGeometry.tail.cgPath)
            let radius = LogoFieldGeometry.dotRadius
            for dot in LogoFieldGeometry.dotCentres {
                context.addEllipse(in: CGRect(x: dot.x - radius, y: dot.y - radius, width: radius * 2, height: radius * 2))
            }
            context.fillPath()
            return true
        }
        image.isTemplate = true
        return image
    }

    // MARK: Showing

    @objc private func toggleUnderItem() { toggle(centered: false) }

    private func toggle(centered: Bool) {
        if panel?.isVisible == true { close() } else { open(centered: centered) }
    }

    private func open(centered: Bool) {
        guard let panel, let model else { return }
        // Opening the panel is coming back: the lock time is checked before anything is drawn.
        model.willOpen(appIsActive: NSApp.isActive)
        let size = panel.frame.size
        var origin = NSPoint.zero
        if !centered, let window = statusItem?.button?.window, let screen = window.screen {
            let frame = screen.visibleFrame
            origin = NSPoint(x: min(max(window.frame.midX - size.width / 2, frame.minX + 8), frame.maxX - size.width - 8),
                             y: window.frame.minY - size.height - 4)
        } else if let screen = NSScreen.main {
            let frame = screen.visibleFrame
            origin = NSPoint(x: frame.midX - size.width / 2, y: frame.midY - size.height / 2 + frame.height * 0.08)
        }
        home = origin
        panel.setFrameOrigin(origin)
        panel.makeKeyAndOrderFront(nil)
        statusItem?.button?.highlight(true)
        model.didOpen()
    }

    /// Closes the panel for anything but the menu bar item and the shortcut, which a panel kept on top ignores.
    private func dismiss(openingApp: Bool = false) {
        if model?.keptOnTop != true { close(openingApp: openingApp) }
        else if openingApp { model?.comingForward() }
    }

    private func close(openingApp: Bool = false) {
        guard let panel, panel.isVisible else { return }
        panel.orderOut(nil)
        swiping = false
        statusItem?.button?.highlight(false)
        model?.keptOnTop = false
        model?.didClose(appIsActive: NSApp.isActive, openingApp: openingApp)
    }

    /// Kept on top, the panel is a floating window on every Space that can be dragged and takes the keyboard from the app in
    /// front only when a field is clicked.
    private func applyKeptOnTop() {
        guard let panel, let model else { return }
        let on = model.keptOnTop
        panel.level = on ? .floating : .popUpMenu
        panel.collectionBehavior = on ? [.canJoinAllSpaces, .fullScreenAuxiliary] : [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isMovableByWindowBackground = on
        panel.becomesKeyOnlyIfNeeded = on
        if !on, panel.isVisible { panel.setFrameOrigin(home) }
    }

    @objc private func lockForAbsence() {
        model?.lockForAbsence()
        dismiss()
    }

    /// A click or app switch closes the panel, except while the system's Touch ID prompt is up.
    private func closeForOutsideAction() {
        if model?.prompter.isPrompting == true { return }
        dismiss()
    }

    /// Brings Psss forward, with a new window when none is open.
    static func openApp(from model: MenuBarModel) {
        model.close(true)
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration)
    }

    // MARK: Shortcut

    /// ⌃⌘P through Carbon, which needs no permission and works in the sandbox.
    private func registerHotKey() {
        var type = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            Task { @MainActor in MenuBarController.shared.toggle(centered: true) }
            return noErr
        }, 1, &type, nil, nil)
        let id = EventHotKeyID(signature: OSType(0x50535353), id: 1)  // "PSSS"
        let status = RegisterEventHotKey(UInt32(kVK_ANSI_P), UInt32(controlKey | cmdKey), id, GetApplicationEventTarget(), 0, &hotKey)
        model?.shortcutTaken = status != noErr
    }

    // MARK: Return on an item's page

    /// Return copies the password or card number, with Shift the username, with Option the code, as in the list. One handler,
    /// because keyboard shortcuts do not tell Return and ⇧Return apart.
    private func pageReturn(_ event: NSEvent) -> Bool {
        guard event.type == .keyDown, event.keyCode == UInt16(kVK_Return) || event.keyCode == UInt16(kVK_ANSI_KeypadEnter),
              event.modifierFlags.intersection([.command, .control]).isEmpty,
              let model, model.tab == .search, let item = model.items().first(where: { $0.id == model.opened }) else { return false }
        // While the page in front is still being read, only an item opened in this opening answers.
        if model.page != .reading || model.chosen { model.copyMain(of: item, modifiers: event.modifierFlags) }
        return true
    }

    // MARK: Swiping back

    /// A swipe to the right on an item's page goes back to the list: two fingers sideways, the page following them as the system
    /// tracks it, or the three-finger swipe where that is the person's setting. True when the event was taken.
    private func swipeBack(_ event: NSEvent) -> Bool {
        if event.type == .scrollWheel, event.phase == .began { scrollJudged = false }
        guard let model, model.tab == .search, let page = model.opened else { return false }
        if event.type == .swipe {
            guard event.deltaX > 0 else { return false }
            model.back()
            return true
        }
        guard event.type == .scrollWheel, !swiping, !scrollJudged, NSEvent.isSwipeTrackingFromScrollEventsEnabled,
              event.phase == .began || event.phase == .changed,
              event.scrollingDeltaX != 0 || event.scrollingDeltaY != 0 else { return false }
        // The gesture's first movement decides: drift later in a vertical scroll is not a swipe.
        scrollJudged = true
        guard event.scrollingDeltaX > 0, abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY) else { return false }
        swiping = true
        var went = false
        event.trackSwipeEvent(options: .lockDirection, dampenAmountThresholdMin: 0, max: 1) { [weak self] amount, phase, complete, stop in
            let goOn = MainActor.assumeIsolated { () -> Bool in
                // Closed, locked or another page meanwhile: this swipe has nothing left to move.
                guard model.panelOpen, model.opened == page else { self?.swiping = false; return false }
                if phase == .ended { went = true }
                model.swipe = amount
                guard complete else { return true }
                self?.swiping = false
                if went { model.back() } else { model.swipe = nil }
                return true
            }
            if !goOn { stop.pointee = true }
        }
        return true
    }

    // MARK: Locking and closing

    private func watch(_ model: MenuBarModel) {
        let workspace = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification] {
            workspace.addObserver(self, selector: #selector(lockForAbsence), name: name, object: nil)
        }
        // Delivered at once also while Psss is not in front, which is where the panel leaves it.
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(lockForAbsence), name: Notification.Name("com.apple.screenIsLocked"),
                                                            object: nil, suspensionBehavior: .deliverImmediately)
        observers.append(workspace.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] note in
            let other = (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier != Bundle.main.bundleIdentifier
            MainActor.assumeIsolated { if other { self?.closeForOutsideAction() } }
        })
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.model?.appLeft() }
        })
        // Clicks in other apps and on the desktop.
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            MainActor.assumeIsolated { self?.closeForOutsideAction() }
        }) { monitors.append(monitor) }
        // Input in Psss, the panel included, keeps it from idling out; a click in another Psss window closes the panel.
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .mouseMoved, .swipe], handler: { [weak self] event in
            // A pointer passing over a panel kept on top, while another app is in front, is not using Psss.
            if !(event.type == .mouseMoved && self?.model?.keptOnTop == true && !NSApp.isActive) { self?.model?.gate.noteInput() }
            if let self, event.window === self.panel, [.leftMouseDown, .keyDown, .scrollWheel].contains(event.type) {
                let locked = MainActor.assumeIsolated {
                    // The main window may have changed the open item since the panel last drew it.
                    if event.type == .leftMouseDown, self.model?.keptOnTop == true { self.model?.refresh() }
                    return self.model?.panelTouched() == true
                }
                // What locked the vault goes no further: the view still holds what it drew before.
                if locked { return nil }
            }
            if let self, event.window === self.panel, MainActor.assumeIsolated({ self.pageReturn(event) || self.swipeBack(event) }) { return nil }
            if event.type == .leftMouseDown, let window = event.window, window !== self?.panel, window.level == .normal { self?.dismiss() }
            return event
        }) { monitors.append(monitor) }
        idleTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if self?.model?.lockIfIdle() == true { self?.dismiss() }
            }
        }
        model.followLocks()
    }
}

/// A panel kept on top answers the first click, while another app has the keyboard.
final class FirstClickHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// A borderless panel does not take the keyboard unless it says it can.
final class MenuBarPanelWindow: NSPanel {
    var cancel: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { cancel?() }
}
#endif
