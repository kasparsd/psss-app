import { Against, Approved, Clarity, Decisions, Frame, Frames, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneItem } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function InlineHelp() {
  return (
    <DeviceProvider>
      <Page title="Inline help" status={<><Approved on="2026-11-23" /> The countdown bubble was removed on 2026-11-24 with the countdown line it explained.</>}>
        <div className="prose">
          <p>A small labeled info button next to a word or a line that a newcomer might not understand. Tapping or clicking it opens a short bubble with a title, two or three sentences and, where useful, one link to read more on the web. The screen itself stays short; the explanation is one tap away and never moves anything.</p>
        </div>
        <Clarity
          items={[
            ['What is it?', 'An explanation, not an action and not a warning. Nothing changes when it opens or closes.'],
            ['Where does it live?', 'The text is in the app, the same on iPhone, iPad and Mac. A link opens the web page in the default browser; nothing about the vault is sent.'],
            ['How do they leave?', 'Tap anywhere outside the bubble, press Escape on Mac, or follow the link.'],
          ]}
        />
        <p className="prose muted">The bubble is one component with its text in one place, and the frames below open it for real: press the info buttons.</p>

        <Section title="1. iPhone" />
        <Frames>
          <Frame phone label="A. The clipboard line" caption="The line under the first group of an item page says copies are cleared after 60 seconds, with the info button after it. Pressing the button opens a popover anchored to it: a title and the explanation. Nothing on the page moves, and tapping outside closes it.">
            <PhoneItem id={1} whole bubble />
          </Frame>
          <Frame phone label="B. In the new-login sheet" caption="The same button explains a term in a form. It sits after the heading “Verification code” and says what a setup key is, where it comes from and why it is secret, with one link marked ↗ that opens in Safari. The field and the Add code button stay as they are. The sheet has the same groups and order as the item page, and the heading under the icon is the name field.">
            <PhoneItem id={2} mode="edit" fresh bubble />
          </Frame>
        </Frames>

        <Section title="2. Mac and iPad" />
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="C. The same bubble on Mac"
            initial="mac"
            caption={{
              iphone: 'The iPhone bubble, as in A.',
              ipad: 'On iPad the bubble is a standard popover with an arrow; it closes with a tap outside.',
              mac: 'On Mac and iPad the bubble is a standard popover with an arrow; it closes with Escape or a click outside. The button also shows a tooltip on hover, “About copies leave the clipboard”.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} whole bubble />, { side: 'all', sel: 1, bubble: true })}
          />
        </div>

        <Section title="3. Where it is used first" />
        <div className="prose">
          <table className="cmp">
            <thead><tr><th>Place</th><th>Button next to</th><th>Bubble says</th><th>Link</th></tr></thead>
            <tbody>
              <tr><td>Editor and new-item sheet, verification code</td><td>The group heading “Verification code”</td><td>What a setup key is, where sites show it, keep it secret.</td><td>How to add a code (Psss help page)</td></tr>
              <tr><td>Item page, verification code</td><td>“Verification code”</td><td>Why the setup key and link are here: to move codes to another app.</td><td>None</td></tr>
              <tr><td>Card editor and card page</td><td>“Security code”</td><td>The three or four digits on the back (front for American Express); sites ask for it at checkout.</td><td>None</td></tr>
              <tr><td>Item page, passkey</td><td>“Passkey”</td><td>A sign-in without a password that only works on the real site.</td><td>About passkeys (Apple Support)</td></tr>
              <tr><td>Recently Deleted</td><td>The title</td><td>Items stay 30 days, then are deleted for good; backups may still hold them.</td><td>None</td></tr>
              <tr><td>Item page, clipboard line</td><td>“Copies are cleared after 60 seconds”</td><td>Why: other apps can read the clipboard; Universal Clipboard is off for copies from Psss.</td><td>None</td></tr>
            </tbody>
          </table>
        </div>

        <Section title="4. Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. One shared component:</strong> an info button that opens a popover with a title, two or three sentences and at most one link.</>,
              rejected: <>text that expands in place; a sheet; Apple's TipKit tips.</>,
              why: <>Expanding text moves the layout, a sheet is heavy for two sentences, and TipKit is for one-time hints that go away, while this has to be there whenever someone wonders. TipKit can still be used later for first-run hints.</>,
            },
            {
              decision: <><strong>2. The button is the system info symbol,</strong> with an accessibility label and a tooltip naming the topic (“About verification codes”).</>,
              why: <>Apple's guidelines allow the info symbol alone; the label and tooltip say what it explains.</>,
            },
            {
              decision: <><strong>3. Bubbles explain; they never hold what the person must know to act.</strong> Required steps, warnings, errors and the consequences of a destructive action stay on the screen in full.</>,
              why: <>Hiding a warning behind a tap is how people miss it. The ui-clarity rules still apply to the screen itself.</>,
            },
            {
              decision: <><strong>4. Links only to a reviewed list of https pages,</strong> kept in one file in shared code, opened in the default browser. Each shows ↗ and the page's name, not a URL. No tracking parameters, nothing from the vault in the address.</>,
              why: <>The link is chosen by us and the same for everyone, so it says nothing about the person. Reviewed each release, so a dead or changed page is caught.</>,
            },
            {
              decision: <><strong>5. Help text lives in one file of topics</strong> (title, text, optional link), used by every platform, and listed in Help so it can be read in one place.</>,
              why: <>One source keeps iPhone, iPad and Mac identical and makes the copy easy to check against the code.</>,
            },
          ]}
        />
        <Against>
          <li>None. Info buttons with popovers are standard on iPhone, iPad and Mac. On iPhone the popover is kept as a bubble rather than turning into a sheet, as Apple allows for short content.</li>
        </Against>

        <History
          entries={[
            { date: '2026-11-24', text: <>Frame B was redrawn with the item page's own editor, after the owner approved its field order and the heading as the name field (see <a href="#/item-page">Item page, Edit and toolbar</a>). The setup key's info button now follows the group heading “Verification code”. Before, the frame drew one card with “Verification code (optional)” as its last field.</> },
            { date: '2026-11-24', text: <>The Codes countdown bubble was removed. The countdown line it explained had already left the Codes list (see <a href="#/places">Places</a>), so the sentence about the previous code no longer has a home. The frames that drew it are gone.</> },
            { date: '2026-11-23', text: <>The Codes countdown line was shortened to “New codes in 18 s” with an info button, and the sentence that most sites also accept the previous code moved into the bubble, because the owner found the full sentence too long for a line that is always on screen. The line itself was removed later the same day.</> },
            { date: '2026-11-23', text: <>The page was approved as drawn: one shared popover component, with text that expands in place, a sheet and TipKit rejected.</> },
          ]}
        />
      </Page>
    </DeviceProvider>
  );
}
