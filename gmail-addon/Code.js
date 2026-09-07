/**
 * TaskTriage Gmail Add-on
 * Connects Gmail to your Supabase MCP Edge Function to create tasks.
 */

const PROPERTIES = PropertiesService.getUserProperties();

/**
 * Entry point when an email is opened.
 */
function onGmailMessageOpen(e) {
  // Check if we have the necessary credentials saved
  const supabaseUrl = PROPERTIES.getProperty('SUPABASE_URL');
  const mcpToken = PROPERTIES.getProperty('MCP_TOKEN');
  const aiApiKey = PROPERTIES.getProperty('AI_API_KEY');

  if (!supabaseUrl || !mcpToken || !aiApiKey) {
    return buildSettingsCard();
  }

  return buildMainCard(e);
}

/**
 * Builds the main card with the "Extract Tasks" button.
 */
function buildMainCard(e) {
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('TaskTriage AI'));

  const section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText('Extract actionable tasks from this email and save them to your TaskTriage inbox.'));

  const extractAction = CardService.newAction()
    .setFunctionName('extractTasksFromEmail')
    .setParameters({ messageId: e.gmail.messageId });

  const extractButton = CardService.newTextButton()
    .setText('✨ Extract Tasks')
    .setOnClickAction(extractAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED);

  section.addWidget(extractButton);

  const settingsAction = CardService.newAction().setFunctionName('openSettings');
  const settingsButton = CardService.newTextButton()
    .setText('⚙️ Settings')
    .setOnClickAction(settingsAction);
  
  section.addWidget(settingsButton);
  card.addSection(section);

  return card.build();
}

/**
 * Action triggered by "Extract Tasks" button.
 */
function extractTasksFromEmail(e) {
  const messageId = e.parameters.messageId;
  const accessToken = e.gmail.accessToken;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  
  const message = GmailApp.getMessageById(messageId);
  const subject = message.getSubject();
  const body = message.getPlainBody();
  
  // Call AI to extract tasks
  const tasks = getTasksFromAI(subject, body);
  
  if (!tasks || tasks.length === 0) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("No tasks found in this email."))
      .build();
  }
  
  // Build a new card to review tasks
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Proposed Tasks'));
    
  const section = CardService.newCardSection();
  
  tasks.forEach(function(task, index) {
    // We use a checkbox group for each task so we can pass data along
    const checkboxGroup = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.CHECK_BOX)
      .setFieldName("task_" + index)
      .addItem(task.name, JSON.stringify(task), true);
    
    section.addWidget(checkboxGroup);
  });
  
  const saveAction = CardService.newAction().setFunctionName('saveTasks');
  const saveButton = CardService.newTextButton()
    .setText('Save Selected Tasks')
    .setOnClickAction(saveAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED);
    
  section.addWidget(saveButton);
  card.addSection(section);
  
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

/**
 * Action triggered by "Save Selected Tasks" button.
 */
function saveTasks(e) {
  const formInputs = e.formInput;
  const tasksToSave = [];
  
  // Extract checked tasks from form data
  Object.keys(formInputs).forEach(function(key) {
    if (key.startsWith('task_')) {
      const taskJson = formInputs[key]; // This is the stringified task
      // Note: Apps Script formInputs gives arrays for checkboxes if multiple selected
      // But we made one group per item, so it might be a single string or array
      const val = Array.isArray(taskJson) ? taskJson[0] : taskJson;
      tasksToSave.push(JSON.parse(val));
    }
  });
  
  if (tasksToSave.length === 0) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("No tasks selected."))
      .build();
  }
  
  const supabaseUrl = PROPERTIES.getProperty('SUPABASE_URL');
  const mcpToken = PROPERTIES.getProperty('MCP_TOKEN');
  
  let successCount = 0;
  
  // Loop through tasks and call the MCP endpoint to create them
  tasksToSave.forEach(function(task) {
    const payload = {
      jsonrpc: "2.0",
      id: Utilities.getUuid(),
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: {
          name: task.name,
          notes: task.notes || "",
          priority: task.priority || "med",
          due_date: task.due_date || null,
          estimated_hours: task.estimated_hours || task.estimatedHours || 1,
          links: task.links || [],
          substeps: task.substeps || []
        }
      }
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': `Bearer ${mcpToken}`
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(`${supabaseUrl}/functions/v1/mcp`, options);
    if (response.getResponseCode() === 200) {
      successCount++;
    }
  });
  
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(`Saved ${successCount} tasks successfully!`))
    .setNavigation(CardService.newNavigation().popToRoot())
    .build();
}

/**
 * Uses Gemini AI API to extract tasks from the email text.
 */
function getTasksFromAI(subject, body) {
  const apiKey = PROPERTIES.getProperty('AI_API_KEY');
  const isOpenAI = apiKey.startsWith('sk-');
  
  const prompt = `You are a helpful assistant that extracts actionable tasks from emails.
Return a JSON object containing a single key "tasks" which is a JSON array of objects.
Each object must have the following structure (include empty arrays/strings if not applicable):
- "name": A concise, action-oriented title for the task (string)
- "notes": A brief summary of context from the email (string)
- "priority": Either "low", "med", or "high" (string)
- "due_date": YYYY-MM-DD if a deadline is mentioned, else "" (string)
- "estimated_hours": Estimated time to complete in hours, e.g. 1 or 0.5 (number)
- "links": Array of objects like {"type": "email", "label": "Sender", "value": "email@example.com"} or "web" for URLs (array)
- "substeps": Array of objects like {"text": "Step 1", "weight": 1} for breaking down the task (array)

Do not use markdown blocks like \`\`\`json. Just return the raw JSON object.

Email Subject: ${subject}
Email Body:
${body.substring(0, 8000)}`;

  let url, options;

  if (isOpenAI) {
    url = 'https://api.openai.com/v1/chat/completions';
    options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      payload: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    };
  }
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const json = JSON.parse(response.getContentText());
    
    let text = "";
    if (isOpenAI) {
      if (json.choices && json.choices[0].message.content) {
        text = json.choices[0].message.content.trim();
      }
    } else {
      if (json.candidates && json.candidates[0].content.parts[0].text) {
        text = json.candidates[0].content.parts[0].text.trim();
      }
    }
    
    if (text) {
      if (text.startsWith('```json')) text = text.substring(7);
      if (text.startsWith('```')) text = text.substring(3);
      if (text.endsWith('```')) text = text.substring(0, text.length - 3);
      
      const parsed = JSON.parse(text.trim());
      return parsed.tasks || [];
    }
    return [];
  } catch (e) {
    Logger.log("AI Extraction Error: " + e.toString());
    return [];
  }
}

// ----------------------------------------------------------------------
// Settings UI
// ----------------------------------------------------------------------

function openSettings() {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildSettingsCard()))
    .build();
}

function buildSettingsCard() {
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Configuration'));
    
  const section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText('Please configure your API connections.'));
    
  const supabaseUrlInput = CardService.newTextInput()
    .setFieldName('supabaseUrl')
    .setTitle('Supabase Project URL')
    .setHint('e.g. https://xyz.supabase.co')
    .setValue(PROPERTIES.getProperty('SUPABASE_URL') || '');
    
  const mcpTokenInput = CardService.newTextInput()
    .setFieldName('mcpToken')
    .setTitle('TaskTriage MCP Token')
    .setHint('Begins with cmt_...')
    .setValue(PROPERTIES.getProperty('MCP_TOKEN') || '');
    
    const aiApiKeyInput = CardService.newTextInput()
    .setFieldName('aiApiKey')
    .setTitle('AI API Key (Gemini or OpenAI)')
    .setHint('Starts with sk- for OpenAI')
    .setValue(PROPERTIES.getProperty('AI_API_KEY') || '');
    
  section.addWidget(supabaseUrlInput);
  section.addWidget(mcpTokenInput);
  section.addWidget(aiApiKeyInput);
  
  const saveAction = CardService.newAction().setFunctionName('saveSettings');
  const saveButton = CardService.newTextButton()
    .setText('Save Settings')
    .setOnClickAction(saveAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED);
    
  section.addWidget(saveButton);
  card.addSection(section);
  
  return card.build();
}

function saveSettings(e) {
  const form = e.formInput;
  
  if (form.supabaseUrl) PROPERTIES.setProperty('SUPABASE_URL', form.supabaseUrl.trim());
  if (form.mcpToken) PROPERTIES.setProperty('MCP_TOKEN', form.mcpToken.trim());
  if (form.aiApiKey) PROPERTIES.setProperty('AI_API_KEY', form.aiApiKey.trim());
  
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("Settings saved!"))
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildMainCard({})))
    .build();
}
