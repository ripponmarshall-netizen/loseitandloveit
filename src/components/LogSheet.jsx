import { LogDock } from './QuickLog.jsx'
import { Sheet } from './ui.jsx'

/** The + button: the same logging card as the Dashboard (type anything, or tap a shortcut). */
export default function LogSheet({ date, onClose }) {
  return (
    <Sheet title="Log" onClose={onClose}>
      <LogDock date={date} bare onDone={onClose} />
    </Sheet>
  )
}
