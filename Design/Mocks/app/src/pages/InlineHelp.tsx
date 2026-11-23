import { Against, Approved, ChangeNote, Clarity, Decisions, Frame, Frames, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { EditRow } from '../components/FieldRow';
import { InfoButton, topics } from '../components/InfoButton';
import { IPhone } from '../components/devices';
import { PhoneCodes, Nav } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

/** A new login's editor with the setup key bubble open. */
function EditorWithBubble() {
  return (
    <IPhone tall>
      <Nav left={<button className="btn plain">Cancel</button>} mid="New login" right={<button className="btn plain" style={{ fontWeight: 600 }}>Save</button>} />
      <div className="pbody" style={{ overflow: 'visible', minHeight: 640 }}>
        <div className="icard">
          <EditRow label="Website" value="gitforge.example" />
          <EditRow label="Username" value="sam.r" />
          <EditRow label="Password" value="x" secret />
          <EditRow
            label="Verification code (optional)"
            info={<InfoButton topic={topics.setupKey} open />}
            placeholder="Setup key"
            action={<button className="btn sq acc">Add code</button>}
          />
        </div>
      </div>
    </IPhone>
  );
}

export function InlineHelp() {
  return (
    <DeviceProvider>
      <Page title="Inline help" status={<><Approved /> as drawn. Being built.</>}>
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
        <ChangeNote>
          The bubble is one component with its text in one place (<code>InfoButton.tsx</code>, “topics”), and the three frames below open it for real: press the info buttons. The link is leading-aligned in the accent colour, as built. The Mac and iPad frame is the Toolbar and Edit layout, with an iPhone option.
        </ChangeNote>

        <Section title="1. iPhone" />
        <Frames>
          <Frame phone label="A. Codes, short countdown" caption="The countdown line is short again: “New codes in 18 s”, with the info button after it. Nothing on the line changes size, so the list never moves. Press the info button.">
            <PhoneCodes />
          </Frame>
          <Frame phone label="B. The bubble open" caption="A popover anchored to the button: a title, the explanation and one link marked ↗, which opens in Safari. Tapping outside closes it.">
            <PhoneCodes variant="bubble" />
          </Frame>
          <Frame phone label="C. In the editor" caption="The same button explains a term in a form: what a setup key is, where it comes from and why it is secret. The field and the Add code button stay as they are.">
            <EditorWithBubble />
          </Frame>
        </Frames>

        <Section title="2. Mac and iPad" />
        <PageDeviceSwitch />
        <div className="frames">
          <DeviceView
            label="D. Mac, the same bubble"
            initial="mac"
            caption={{
              iphone: 'The iPhone bubble, as in B.',
              ipad: 'On iPad the bubble is a standard popover with an arrow; it closes with a tap outside.',
              mac: 'On Mac and iPad the bubble is a standard popover with an arrow; it closes with Escape or a click outside. The button also shows a tooltip, “About verification codes”, on hover.',
            }}
            render={(d) => renderDevice(d, <PhoneCodes variant="bubble" />, { side: 'codes', bubble: true })}
          />
        </div>

        <Section title="3. Where it would be used first" />
        <div className="prose">
          <table className="cmp">
            <thead><tr><th>Place</th><th>Button next to</th><th>Bubble says</th><th>Link</th></tr></thead>
            <tbody>
              <tr><td>Codes</td><td>“New codes in 18 s”</td><td>Codes last 30 seconds; most sites accept the one just before.</td><td>Which sites offer two-step verification (2fa.directory)</td></tr>
              <tr><td>Editor, verification code</td><td>“Verification code (optional)”</td><td>What a setup key is, where sites show it, keep it secret.</td><td>How to add a code (Psss help page)</td></tr>
              <tr><td>Detail, verification code setup</td><td>“Verification code setup”</td><td>Why the setup key and link are here: to move codes to another app.</td><td>None</td></tr>
              <tr><td>Card editor and Cards</td><td>“Security code”</td><td>The three or four digits on the back (front for American Express); sites ask for it at checkout.</td><td>None</td></tr>
              <tr><td>Detail, passkeys</td><td>“Passkey”</td><td>A sign-in without a password that only works on the real site.</td><td>About passkeys (Apple Support)</td></tr>
              <tr><td>Recently Deleted</td><td>The title</td><td>Items stay 30 days, then are deleted for good; backups may still hold them.</td><td>None</td></tr>
              <tr><td>Detail, clipboard line</td><td>“Copies are cleared after 60 seconds”</td><td>Why: other apps can read the clipboard; Universal Clipboard is off for copies from Psss.</td><td>None</td></tr>
            </tbody>
          </table>
        </div>

        <Section title="4. Decisions to approve" />
        <Decisions
          items={[
            {
              decision: <>One shared component: an info button that opens a popover with a title, two or three sentences and at most one link.</>,
              rejected: <>text that expands in place; a sheet; Apple's TipKit tips.</>,
              why: <>Expanding text moves the layout, a sheet is heavy for two sentences, and TipKit is for one-time hints that go away, while this has to be there whenever someone wonders. TipKit can still be used later for first-run hints.</>,
            },
            {
              decision: <>The button is the system info symbol, with an accessibility label and a tooltip naming the topic (“About verification codes”).</>,
              why: <>Apple's guidelines allow the info symbol alone; the label and tooltip say what it explains.</>,
            },
            {
              decision: <>Bubbles explain; they never hold what the person must know to act. Required steps, warnings, errors and the consequences of a destructive action stay on the screen in full.</>,
              why: <>Hiding a warning behind a tap is how people miss it. The ui-clarity rules still apply to the screen itself.</>,
            },
            {
              decision: <>Links only to a reviewed list of https pages, kept in one file in shared code, opened in the default browser. Each shows ↗ and the page's name, not a URL. No tracking parameters, nothing from the vault in the address.</>,
              why: <>The link is chosen by us and the same for everyone, so it says nothing about the person. Reviewed each release, so a dead or changed page is caught.</>,
            },
            {
              decision: <>The Codes countdown becomes “New codes in 18 s” plus the button; the sentence about the previous code moves into its bubble.</>,
              why: <>The owner found the full sentence too long for a line that is always on screen.</>,
            },
            {
              decision: <>Help text lives in one file of topics (title, text, optional link), used by every platform, and listed in Help so it can be read in one place.</>,
              why: <>One source keeps iPhone, iPad and Mac identical and makes the copy easy to check against the code.</>,
            },
          ]}
        />
        <Against>
          <li>None. Info buttons with popovers are standard on iPhone, iPad and Mac. On iPhone the popover is kept as a bubble rather than turning into a sheet, as Apple allows for short content.</li>
        </Against>
      </Page>
    </DeviceProvider>
  );
}
