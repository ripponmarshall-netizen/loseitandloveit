import { LogDock } from './QuickLog.jsx'
import { Sheet, useSheetClose } from './ui.jsx'

/** The + button: the same logging card as the Dashboard (type anything, or tap a shortcut). */
export default function LogSheet({ date, onClose }) {
  const [sheetRef, dismiss] = useSheetClose(onClose)
  return (
    <Sheet ref={sheetRef} title="Log" onClose={onClose}>
      <LogDock date={date} bare onDone={dismiss} />
    </Sheet>
  )
}
