# TaskTriage Gmail Add-on

This directory contains the code for a Google Workspace Add-on that runs directly inside Gmail (on web and mobile). It reads your currently open email, uses Google's Gemini API to extract actionable tasks, and saves them to your TaskTriage database via your existing Supabase MCP Edge Function.

## How to Install (Using the browser)
1. Go to [script.google.com](https://script.google.com) and create a new project.
2. Name the project **TaskTriage Add-on**.
3. In the editor, you will see a file named `Code.gs`. Replace its contents with the code from `Code.js` in this folder.
4. Go to **Project Settings** (the gear icon on the left) and check the box that says **"Show 'appsscript.json' manifest file in editor"**.
5. Go back to the Editor (the `< >` icon). You will now see `appsscript.json`.
6. Replace the contents of `appsscript.json` with the file in this folder.
7. Click the **Save** icon.
8. Click **Deploy > Test deployments**. Select "Install" to test it on your own Gmail account.

## How to Install (Using Clasp CLI)
If you prefer the command line:
```bash
npm install -g @google/clasp
clasp login
cd gmail-addon
clasp create --type standalone --title "TaskTriage Add-on"
clasp push
```

## Configuration
When you first open the add-on in Gmail by clicking an email, you will be prompted to enter:
1. **Supabase Project URL**: (e.g. `https://xyz.supabase.co`)
2. **TaskTriage MCP Token**: Your personal token (starts with `cmt_`)
3. **Gemini API Key**: You can generate a free one at [Google AI Studio](https://aistudio.google.com/app/apikey).
