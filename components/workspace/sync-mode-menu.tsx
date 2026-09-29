'use client'

// "Cloud sync" submenu for a page or folder — shared by the desktop tree's
// context menus and the mobile dropdowns (same Radix shapes, different
// primitives). Three plain-language choices mapping to lib/sync/page-sync.ts
// modes, plus "Same as folder" when the setting is inherited.

import { Cloud, CloudOff, CloudUpload, FolderSync } from 'lucide-react'
import {
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import type { SyncMode } from '@/lib/sync/page-sync'

type Choice = SyncMode | 'inherit'

const OPTIONS: { value: Choice; label: string; hint: string; icon: typeof Cloud }[] = [
  { value: 'auto', label: 'Sync content', hint: 'Text, ink and objects everywhere. Large files stay here.', icon: Cloud },
  { value: 'full', label: 'Sync with files', hint: 'Also back up attached files — uses cloud storage.', icon: CloudUpload },
  { value: 'local', label: 'Keep on this device', hint: 'Removes the cloud copy. Hidden on other devices.', icon: CloudOff },
]

const LABEL: Record<SyncMode, string> = { auto: 'Content', full: 'With files', local: 'This device' }

/** `flag` is the node's own syncEnabled; `effective` its resolved mode. */
export function SyncModeMenu({
  variant,
  flag,
  effective,
  inheritable,
  onChange,
}: {
  variant: 'context' | 'dropdown'
  flag: boolean | undefined
  effective: SyncMode
  /** folders and nested pages can fall back to their parent's setting */
  inheritable?: boolean
  onChange: (mode: Choice) => void
}) {
  const value: Choice = flag === true ? 'full' : flag === false ? 'local' : inheritable ? 'inherit' : 'auto'
  const [Sub, Trigger, Content, Group, Item] =
    variant === 'context'
      ? [ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuRadioGroup, ContextMenuRadioItem]
      : [DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem]
  const options = inheritable
    ? [{ value: 'inherit' as const, label: 'Same as folder', hint: `Currently: ${LABEL[effective]}`, icon: FolderSync }, ...OPTIONS]
    : OPTIONS
  return (
    <Sub>
      <Trigger className="gap-2">
        {effective === 'local' ? <CloudOff className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
        <span className="flex-1">Cloud sync</span>
        <span className="text-ui-xs text-muted-foreground">{LABEL[effective]}</span>
      </Trigger>
      <Content className="w-64">
        <Group value={value} onValueChange={(v: string) => onChange(v as Choice)}>
          {options.map((o) => (
            <Item key={o.value} value={o.value} className="items-start py-2">
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  <o.icon className="h-3.5 w-3.5" /> {o.label}
                </span>
                <span className="text-ui-xs leading-snug text-muted-foreground">{o.hint}</span>
              </span>
            </Item>
          ))}
        </Group>
      </Content>
    </Sub>
  )
}
