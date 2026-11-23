import { Against, Approved, ChangeNote, Clarity, Decisions, Page, Section } from '../components/page';
import { DeviceProvider, DeviceView, PageDeviceSwitch } from '../components/DeviceSwitcher';
import { PhoneItem } from '../screens/PhoneScreens';
import { renderDevice } from '../screens/render';

export function CopyIcons() {
  return (
    <DeviceProvider>
      <Page
        title="Copy icons and the Copied pill"
        status={<><Approved />, with Show as an eye beside the dots. Being built.</>}
      >
        <Clarity
          items={[
            ['What changes?', <>On an item's page each field's “Copy” text becomes the copy icon. Copying turns the icon into a checkmark for a moment and shows a pill near the bottom: “Password copied”.</>],
            ['What else?', <>Show becomes an eye right after the dots. Copies still stay on the device and are cleared after 60 seconds; the line under the fields says so, with its info button.</>],
          ]}
        />
        <ChangeNote>
          Drawn with the shared field row, so every frame is clickable (copy, eye, Add code) and the same row appears on the item page, in the Cards tab and in the Mac and iPad columns. The frames now work on iPhone, iPad and Mac with the switch above each one; the old separate Mac frame is folded into them. The Mac and iPad item page is the current “Toolbar and Edit” layout, and the editor there also ends with Delete Item. A row with nothing to copy (a login without a code shows “None” and a labelled Set Up Code… button) has no copy icon.
        </ChangeNote>
        <PageDeviceSwitch />

        <Section title="1. The item page" />
        <div className="frames">
          <DeviceView
            label="A. Item page"
            caption={{
              iphone: 'Each field has the copy icon at its trailing end, in the system accent, with a full-size touch target. VoiceOver reads “Copy username”, “Copy password”.',
              ipad: 'The same row in the item column. iPad is the same as Mac.',
              mac: 'The same icon, with a tooltip “Copy password” on hover.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} />, { side: 'recent', sel: 1 })}
          />
          <DeviceView
            label="B. Just copied"
            caption={{
              iphone: 'The icon turns into a checkmark with the system\'s replace animation and a light haptic. The pill rises above the tab bar, names what was copied and fades after about two seconds. Copying again replaces it.',
              ipad: 'The pill sits at the bottom centre of the window.',
              mac: 'The pill appears at the bottom centre of the window. iPad is the same.',
            }}
            render={(d) => renderDevice(d, <PhoneItem id={1} copied="Password" pill="Password copied" />, { side: 'recent', sel: 1, copied: 'Password' })}
          />
          <DeviceView
            label="C. Password shown"
            caption="The eye sits right after the dots, the one control not aligned to the right edge. Pressing it shows the password in place; a long one wraps and the rows below move down with a short animation (a cross-fade with Reduce Motion), and the eye becomes an eye with a slash. Hidden values always show the same eight dots, so their length is never hinted."
            render={(d) => renderDevice(d, <PhoneItem id={1} shown={['Password']} />, { side: 'recent', sel: 1, shown: ['Password'] })}
          />
        </div>

        <Section title="2. The editor" />
        <div className="frames">
          <DeviceView
            label="D. Editor: a login with a code"
            caption="The field's action sits on the right of its input, on the same line: “Replace code” once a code is set. Remove code, being destructive, stays on its own row below. Every trailing control keeps the same inset from the right edge as the text has from the left. Delete Item closes the form."
            render={(d) => renderDevice(d, <PhoneItem id={1} mode="edit" />, { side: 'recent', sel: 1, editing: true })}
          />
          <DeviceView
            label="E. Editor: a login without a code"
            caption="“Add code” sits on the right of the setup key input. Press it and it becomes “Replace code”, with “Remove code” below."
            render={(d) => renderDevice(d, <PhoneItem id={2} mode="edit" />, { side: 'recent', sel: 2, editing: true })}
          />
        </div>

        <Section title="3. Decisions to approve" />
        <Decisions
          items={[
            {
              decision: <>The per-field copy action on item pages is the copy icon, not the word.</>,
              rejected: <>keeping “Copy” on every row.</>,
              why: <>It repeats on every row and is widely understood; the owner prefers the quieter page. This is a stated exception to the project rule for labeled actions, limited to this row action: it always has an accessibility label naming the field, a tooltip on Mac and a 44 pt target.</>,
            },
            {
              decision: <>Show is an eye icon placed right after the dots, not at the right edge; it becomes an eye with a slash while the value is shown.</>,
              why: <>The owner's exception to the alignment rule (2026-11-23): the eye belongs to the hidden value, the copy icon to the row. It carries the label “Show password” / “Hide password” and a tooltip on Mac.</>,
            },
            {
              decision: <>Hidden values always show the same eight dots (a card number keeps “•••• 4417”, its last four on purpose). Revealing may change the row's height; the change is animated and checked on every platform.</>,
              why: <>A mask that matches the secret's length tells an onlooker how long it is.</>,
            },
            {
              decision: <>Feedback in two places: the icon becomes a checkmark, and a pill names what was copied.</>,
              rejected: <>“Copied” replacing the row's label (the old way); the pill alone.</>,
              why: <>The checkmark confirms at the point of the tap; the pill confirms which field, which matters when rows look alike. Both use the system symbol animation and respect Reduce Motion (cross-fade instead).</>,
            },
            {
              decision: <>One pill component for every copy in the app. It also covers the Cards tab and the Mac and iPad columns now, since they use the same row. Codes keep their own in-row “Copied” on the code button.</>,
              why: <>The Codes button already says “Copied” in place, so a second message would be noise. (Changed from the earlier draft, which left Cards with its own “Copied”: Cards now uses the shared field row, see <a href="#/cards-tab">Cards tab</a>.)</>,
            },
            {
              decision: <>Convention: a field's action sits at the trailing end of its own row, on the same line as the value or input, and every trailing icon or button is right-aligned with the same inset as the row's leading padding. Applies to copy icons, info buttons in rows, and editor actions such as Add code and Replace code. Destructive actions (Remove code) get their own row.</>,
              why: <>The owner's rule (2026-11-23): one place to look for a field's action, and rows that line up on both edges. A labelled button that acts on a whole field with no value to copy (Set Up Code…) sits under that field instead.</>,
            },
          ]}
        />

        <Against>
          <li>None: the copy symbol is a standard SF Symbol and icon buttons in rows are common. The departure is from this project's own rule for labeled actions, as stated in decision 1.</li>
        </Against>
      </Page>
    </DeviceProvider>
  );
}
