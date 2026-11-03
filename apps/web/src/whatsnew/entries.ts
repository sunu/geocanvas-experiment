/**
 * What's new: what people on a board can see changed, newest first, written by hand. Every push deploys, so there are
 * no release numbers: an entry is a date, and a person has seen it up to the newest date they opened the dialog on
 * (seen.ts). Write for the people who use the board, not for contributors: what they can now do, not how. Add an
 * entry (or lines to today's) in a pull request that people would notice.
 */
export interface NewsEntry {
  /** `YYYY-MM-DD`. */
  date: string
  new?: string[]
  improved?: string[]
  fixed?: string[]
}

export const SECTIONS = [
  ['new', 'New'],
  ['improved', 'Improved'],
  ['fixed', 'Fixed'],
] as const

export const NEWS: NewsEntry[] = [
  {
    date: '2026-11-03',
    new: [
      'What’s new, here: what changed on the board, and which build you are on, with a button to copy it for a bug report.',
      'Open an object from a link: Copy link in the right-click menu, and the agent can show you an object it names.',
      'Skills in Settings: read the agent’s built-in skills and write your own for a board, and keep them in My skills to add to other boards.',
      'Turn plugins off for a board in Settings. What they already added stays.',
      'A small model that runs in your browser, besides your own key and local servers, in the chat’s model menu.',
      'A shared password for the whole deployment.',
    ],
    improved: [
      'The chat is shared by many people: each reply sits under its question, an unanswered message shows its place in the queue, you can show only your own requests, and the broom compacts a long chat.',
      'Names follow a rename in the chat and on code cells.',
      'The agent can make up to 30 model calls for one request.',
      'Reports: text is rich text, and pasted Markdown becomes headings, lists and links.',
    ],
    fixed: ['A map follows the latest view until you move it yourself.'],
  },
  {
    date: '2026-10-30',
    new: [
      'Reports: pages, editing on the page, drag objects onto a report, and Print or save as PDF.',
      'Code cells that run Python on your own JupyterHub, with their output on maps, images and notes.',
      'A country’s disaster history (EM-DAT) and past disasters in an area (DesInventar).',
      'Flood exposure: the buildings and facilities in a scenario’s flood areas, and a river flood’s depth and damage.',
      'A phone layout: Ask, the board as a list, and one widget full screen.',
      'The agent has a cursor, and each person has a color of their own.',
    ],
  },
]
