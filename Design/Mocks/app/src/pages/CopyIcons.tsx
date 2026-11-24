import { Against, Approved, Clarity, Decisions, History, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneItem } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function CopyIcons() {
  return (
    <DeviceProvider>
      <Page
        title="Copying a field"
        status={<><Approved on="2026-11-24" /> The copy icon, the pill and the eye were approved on 2026-11-23; the whole row copying was approved on 2026-11-24. The item page itself is on <a href="#/item-page">Item page, Edit and toolbar</a>.</>}
      >
        <Clarity
          items={[
            ['What happens?', <>On an item's page a tap or click anywhere on a field's row copies it. The row's copy icon turns into a checkmark for a moment and a pill near the bottom says what was copied: “Password copied”. The icon stays as the visible sign that the row copies.</>],
            ['What else?', <>Hidden values show eight dots and an eye right after them; the eye never copies. Copies stay on the device and are cleared after 60 seconds; the line under the first group says so, with its info button.</>],
            ['What can go wrong?', 'They copy a field they did not mean to (the pill names what was copied, and it leaves the clipboard after 60 seconds). They reveal a password by accident (the eye is its own target, and a value hides again when the item is left).'],
          ]}
        />
        <PageDeviceSwitch />

        <Section title="1. The item page" />
        <div className="frames">
          <DeviceView
            label="A. Item page"
            caption={{
              iphone: 'Each field has the copy icon at its trailing end, in the system accent, with a full-size touch target; a tap anywhere on the row copies. Rows with nothing to copy (“None” with Set Up Code…, the passkey line) do nothing when tapped. VoiceOver reads “Copy username”, “Copy password”.',
              ipad: 'The same row in the item column. iPad is the same as Mac.',
              mac: 'The row highlights under the pointer and a click copies. The icon shows a tooltip “Copy password” on hover.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} />, { side: 'all', sel: 1 })}
          />
          <DeviceView
            label="B. Just copied"
            caption={{
              iphone: 'The row darkens while pressed, the icon turns into a checkmark with the system\'s replace animation and a light haptic. The pill rises above the tab bar, names what was copied and fades after about two seconds. Copying again replaces it.',
              ipad: 'The pill sits at the bottom centre of the window.',
              mac: 'The pill appears at the bottom centre of the window. iPad is the same.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} copied="Password" pill="Password copied" />, { side: 'all', sel: 1, copied: 'Password' })}
          />
          <DeviceView
            label="C. Password shown"
            caption="The eye sits right after the dots, the one control not aligned to the right edge. Pressing it shows the password in place, in the monospaced face used for every secret shown in the clear; a long one wraps and the rows below move down with a short animation (a cross-fade with Reduce Motion), and the eye becomes an eye with a slash. Hidden values always show the same eight dots, so their length is never hinted."
            render={(d) => renderDevice(d, <PhoneItem id={1} shown={['Password']} />, { side: 'all', sel: 1, shown: ['Password'] })}
          />
        </div>

        <Section title="2. Decisions" />
        <Decisions
          items={[
            {
              decision: <><strong>1. The whole field row copies.</strong> A tap or click anywhere on a row that has a copy icon copies that field, with the same checkmark, pill and haptic. The copy icon stays. The eye stays its own button. Rows without a copy icon do nothing. On Mac the row highlights under the pointer.</>,
              rejected: <>the icon as the only way (decided 2026-11-23, to avoid a hidden gesture); removing the icon once the row copies; the word “Copy” on every row.</>,
              why: <>A whole row is an easier target than a 17 pt glyph, and with the icon kept the gesture is not hidden. The risk the icon-only rule guarded against, copying by accident while aiming for the eye, is handled by keeping the eye's own target.</>,
            },
            {
              decision: <><strong>2. The cue is the copy icon, not the word.</strong> The system copy symbol, with an accessibility label naming the field, a tooltip on Mac and a 44 pt target.</>,
              why: <>The word repeats on every row, and the owner prefers the quieter page. This is a stated exception to the project rule for labeled actions, limited to this row action.</>,
            },
            {
              decision: <><strong>3. Show is an eye icon placed right after the dots,</strong> not at the right edge; it becomes an eye with a slash while the value is shown, with the label “Show password” / “Hide password” and a tooltip on Mac.</>,
              why: <>The owner's exception to the alignment rule: the eye belongs to the hidden value, the copy icon to the row.</>,
            },
            {
              decision: <><strong>4. Hidden values always show the same eight dots,</strong> a card number and a security code too. Revealing may change the row's height; the change is animated and checked on every platform.</>,
              rejected: <>a mask that keeps a card's last four digits.</>,
              why: <>A mask that matches the secret's length tells an onlooker how long it is, and one rule is easier to trust on every screen.</>,
            },
            {
              decision: <><strong>5. Feedback in two places:</strong> the icon becomes a checkmark, and a pill names what was copied.</>,
              rejected: <>“Copied” replacing the row's label; the pill alone.</>,
              why: <>The checkmark confirms at the point of the tap; the pill confirms which field, which matters when rows look alike. Both use the system symbol animation and respect Reduce Motion (cross-fade instead).</>,
            },
            {
              decision: <><strong>6. One pill component for every copy on an item page,</strong> including cards and the Mac and iPad columns. Codes keep their own in-row “Copied” on the code button.</>,
              why: <>The Codes button already says “Copied” in place, so a second message would be noise.</>,
            },
            {
              decision: <><strong>7. Where a field's action sits.</strong> At the trailing end of its own row, on the same line as the value, right-aligned with the same inset as the row's leading padding. This covers copy icons and info buttons in rows. Editor actions follow the same rule (see <a href="#/item-page">Item page, Edit and toolbar</a>).</>,
              why: <>The owner's rule: one place to look for a field's action, and rows that line up on both edges. A labelled button that acts on a whole field with no value to copy (Set Up Code…) sits under that field instead.</>,
            },
          ]}
        />

        <Against>
          <li>None: the copy symbol is a standard SF Symbol and icon buttons in rows are common. The departure is from this project's own rule for labeled actions, as stated in decision 2.</li>
          <li><strong>A tap on a field copies at once.</strong> Passwords opens a small menu (“Copy Password”) on a tap. Copying directly is one step shorter; the pill says what happened.</li>
        </Against>

        <History
          entries={[
            { date: '2026-11-24', text: <>The whole row copies, and the icon stays as the visible sign. This reverses the 2026-11-23 decision that the icon is the only way, which was made to avoid a hidden gesture. A row is an easier target than a glyph, and the risk of copying while aiming for the eye is handled by the eye's own target. The owner approved it.</> },
            { date: '2026-11-23', text: <>Hidden values show eight dots everywhere. The mock had first kept “•••• 4417” on a card number; the owner decided on eight dots on every screen, the Cards list included.</> },
            { date: '2026-11-23', text: <>The pill covers the Cards tab and the Mac and iPad columns too, because they use the same field row. An earlier draft had left Cards with its own “Copied”.</> },
            { date: '2026-11-23', text: <>Show became an eye icon right after the dots, an exception to the alignment rule that the owner approved. Before, each row had labelled Show and Copy buttons.</> },
            { date: '2026-11-23', text: <>The copy icon replaced the word “Copy” on every row, because the owner prefers the quieter page; this is an exception to the project rule for labeled actions. Feedback moved from “Copied” replacing the row's label to a checkmark plus a pill that names the field.</> },
            { date: '2026-11-23', text: <>The row of copy buttons under the icon and name was removed at the owner's request: the fields below hold all the data, each with its own copy.</> },
            { date: '2026-11-23', text: <>The owner set the rule for where a field's action sits: at the trailing end of its own row, with the same inset as the leading text, and destructive actions on their own row.</> },
          ]}
        />
      </Page>
    </DeviceProvider>
  );
}
