import { useState } from 'react'
import { PlusIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import logo from '../assets/logo.svg'
import { roomFromLink, roomHash } from '../board/room'
import { BoardCard } from './BoardCard'
import { NewBoardDialog } from './NewBoardDialog'
import { forgetBoard, listBoards, type BoardSort } from './recents'

/** Open a board someone shared, by its link or room id. */
function OpenLink() {
  const [text, setText] = useState('')
  const room = roomFromLink(text)
  return (
    <form
      className="flex w-full max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (room) location.hash = roomHash(room)
      }}
    >
      <Input aria-label="Board link" placeholder="Paste a board link" value={text} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" variant="outline" disabled={!room}>
        Open
      </Button>
    </form>
  )
}

/**
 * The landing page, shown without a #room: the boards this browser has opened (recents.ts) and New board.
 * #new opens the New board dialog at once (the title bar's New board).
 */
export function Landing({ startNew }: { startNew: boolean }) {
  const [sort, setSort] = useState<BoardSort>('opened')
  const [creating, setCreating] = useState(startNew)
  const [, refresh] = useState(0)
  const boards = listBoards(sort)

  return (
    <div className="ttx-ui min-h-full bg-background font-sans text-foreground">
      <header className="flex items-center gap-2 border-b px-6 py-3">
        <img src={logo} alt="" className="size-8" />
        <span className="font-medium">Humanitarian TTX</span>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-10">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">Boards</h1>
          <div className="flex items-center gap-2">
            {boards.length > 1 && (
              <Select value={sort} onValueChange={(v) => setSort(v as BoardSort)}>
                <SelectTrigger aria-label="Sort boards">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opened">Last opened</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              New board
            </Button>
          </div>
        </div>
        {boards.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-6">
            {boards.map((b) => (
              <BoardCard
                key={b.room}
                board={b}
                onForget={() => {
                  forgetBoard(b.room)
                  refresh((n) => n + 1)
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed px-6 py-16 text-center">
            <p className="font-medium">No boards in this browser yet</p>
            <p className="max-w-md text-sm text-muted-foreground">Start a new board, or open one someone shared with you. Boards you open are listed here.</p>
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              New board
            </Button>
            <OpenLink />
          </div>
        )}
      </main>
      <NewBoardDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open)
          // Closing the dialog opened by #new leaves the landing at its own URL.
          if (!open && location.hash) history.replaceState(null, '', location.pathname + location.search)
        }}
      />
    </div>
  )
}
