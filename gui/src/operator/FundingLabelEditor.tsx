import React, { useEffect, useRef, useState } from 'react'
import type { FundingGoalSnapshot } from '../shared/funding-goal'
import { parseFundingGoalLabelDraft } from './model'

interface FundingLabelEditorProps {
  goal: Pick<FundingGoalSnapshot, 'label' | 'labelOverridden'>
  pending: boolean
  onSave: (label: string) => Promise<boolean>
  onReset: () => void
}

export function FundingLabelEditor({ goal, pending, onSave, onReset }: FundingLabelEditorProps) {
  const [draft, setDraft] = useState(goal.label)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const parsedLabel = parseFundingGoalLabelDraft(draft)
  const changed = parsedLabel !== null && parsedLabel !== goal.label

  useEffect(() => {
    if (!editing) setDraft(goal.label)
  }, [editing, goal.label])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const cancel = () => {
    setDraft(goal.label)
    setEditing(false)
  }
  const save = async () => {
    if (!changed || parsedLabel === null) return
    if (await onSave(parsedLabel)) setEditing(false)
  }

  return (
    <label className="funding-label-editor">
      <span>Goal label</span>
      <span className="funding-label-editor__controls">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          readOnly={!editing}
          disabled={pending}
          aria-invalid={editing && parsedLabel === null}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void save()
            } else if (event.key === 'Escape') {
              cancel()
            }
          }}
        />
        {editing ? (
          <>
            <button type="button" className="quiet" disabled={pending || !changed} onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="quiet" disabled={pending} onClick={cancel}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="quiet" disabled={pending} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {goal.labelOverridden && !editing && (
          <button type="button" className="quiet" disabled={pending} onClick={onReset}>
            Use config default
          </button>
        )}
      </span>
    </label>
  )
}
