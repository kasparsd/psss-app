#if os(macOS) && DEBUG
import AppKit
import Carbon.HIToolbox
import SwiftUI

/// Prototype of the menu bar item (docs/plans/mac-menu-bar.md): a status item and ⌃⌘P open a panel that leaves the other app in
/// front. Debug builds only, and only with the launch argument `-psss-menu-bar` (the real vaults) or `-psss-menu-bar-sample` (the
/// compiled-in sample vault, nothing of the person's is touched).
///
/// The app's lock triggers live in the window's view, so they stop with the last window. The panel therefore watches sleep, screen
/// lock, idle time and time away itself, and every lock it makes also drops the open vaults.
@MainActor
final class MenuBarController: NSObject {
    static let shared = MenuBarController()
    static let panelSize = NSSize(width: 400, height: 580)

    private var statusItem: NSStatusItem?
    private var panel: MenuBarPanelWindow?
    private var model: MenuBarModel?
    private var hotKey: EventHotKeyRef?
    private var observers: [NSObjectProtocol] = []
    private var monitors: [Any] = []
    private var idleTimer: Task<Void, Never>?
    private var swiping = false

    func startIfRequested(session: VaultSession, gate: UnlockGate) {
        let arguments = ProcessInfo.processInfo.arguments
        let sample = arguments.contains("-psss-menu-bar-sample")
        guard statusItem == nil, sample || arguments.contains("-psss-menu-bar") else { return }
        let model = MenuBarModel(session: session, gate: gate, sample: sample ? SampleVaultStore() : nil)
        model.close = { [weak self] openingApp in self?.close(openingApp: openingApp) }
        self.model = model

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = Self.mark()
        item.button?.toolTip = "Psss"
        item.button?.setAccessibilityLabel("Psss")
        item.button?.target = self
        item.button?.action = #selector(toggleUnderItem)
        statusItem = item

        let panel = MenuBarPanelWindow(contentRect: NSRect(origin: .zero, size: Self.panelSize),
                                       styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.setAccessibilityLabel("Psss")
        // The system's glass is the panel's whole surface; it draws the edge, so there is no outline of our own.
        let glass = NSGlassEffectView(frame: NSRect(origin: .zero, size: Self.panelSize))
        glass.cornerRadius = 16
        glass.contentView = NSHostingView(rootView: MenuBarPanelView(model: model))
        panel.contentView = glass
        self.panel = panel

        registerHotKey()
        watch(model)
    }

    /// The outline ring with its dot, as a template image the system colours.
    private static func mark() -> NSImage {
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { rect in
            NSColor.black.set()
            let ring = NSBezierPath(ovalIn: rect.insetBy(dx: 2, dy: 2))
            ring.lineWidth = 2
            ring.stroke()
            NSBezierPath(ovalIn: rect.insetBy(dx: 5.5, dy: 5.5)).fill()
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
        panel.setFrameOrigin(origin)
        panel.makeKeyAndOrderFront(nil)
        statusItem?.button?.highlight(true)
        model.didOpen()
    }

    private func close(openingApp: Bool = false) {
        guard let panel, panel.isVisible else { return }
        panel.orderOut(nil)
        statusItem?.button?.highlight(false)
        model?.didClose(appIsActive: NSApp.isActive, openingApp: openingApp)
    }

    @objc private func lockForAbsence() {
        model?.lockForAbsence()
        close()
    }

    /// A click or app switch closes the panel, except while the system's Touch ID prompt is up.
    private func closeForOutsideAction() {
        if model?.prompter.isPrompting == true { return }
        close()
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

    // MARK: Swiping back

    /// A swipe to the right on an item's page goes back to the list: two fingers sideways, the page following them as the system
    /// tracks it, or the three-finger swipe where that is the person's setting. True when the event was taken.
    private func swipeBack(_ event: NSEvent) -> Bool {
        guard let model, model.tab == .search, model.opened != nil else { return false }
        if event.type == .swipe {
            guard event.deltaX > 0 else { return false }
            model.back()
            return true
        }
        guard event.type == .scrollWheel, !swiping, NSEvent.isSwipeTrackingFromScrollEventsEnabled,
              event.phase == .began || event.phase == .changed,
              event.scrollingDeltaX > 0, abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY) else { return false }
        swiping = true
        var went = false
        event.trackSwipeEvent(options: .lockDirection, dampenAmountThresholdMin: 0, max: 1) { [weak self] amount, phase, complete, _ in
            MainActor.assumeIsolated {
                if phase == .ended { went = true }
                model.swipe = amount
                guard complete else { return }
                self?.swiping = false
                if went { model.back() } else { model.swipe = nil }
            }
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
            self?.model?.gate.noteInput()
            if let self, event.window === self.panel, MainActor.assumeIsolated({ self.swipeBack(event) }) { return nil }
            if event.type == .leftMouseDown, let window = event.window, window !== self?.panel, window.level == .normal { self?.close() }
            return event
        }) { monitors.append(monitor) }
        idleTimer = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if self?.model?.lockIfIdle() == true { self?.close() }
            }
        }
        model.followLocks()
    }
}

/// A borderless panel does not take the keyboard unless it says it can.
final class MenuBarPanelWindow: NSPanel {
    override var canBecomeKey: Bool { true }
}
#endif
