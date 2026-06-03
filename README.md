# Commitments

A workload-aware deadline tracker. Built with React, Vite, and Supabase. 

## Development

```bash
npm install
npm run dev
```

Create a `.env.local` file (see `.env.example`) with your Supabase URL and anon key.

## Stack

- **Frontend:** React 18 + Vite
- **Backend / Auth / DB:** Supabase (PostgreSQL + RLS)
- **Deployment:** Vercel (recommended)

## Project structure

```
src/
  lib/
    supabase.js      # Supabase client singleton
    db.js            # All database queries + ICS export
  hooks/
    useAppData.js    # Central state hook (loads, mutates, undo/redo)
  components/
    Shell.jsx        # Top-level layout, tabs, toolbar
  styles/
    shell.css
  App.jsx            # Auth gate → Shell
  main.jsx
  index.css          # CSS custom properties / global reset
```
