/**
 * TaskTriage Gmail Add-on
 * Connects Gmail to your Supabase MCP Edge Function to create tasks.
 */

var PROPERTIES = PropertiesService.getUserProperties();

/**
 * Entry point when an email is opened.
 */
function onGmailMessageOpen(e) {
  // Check if we have the necessary credentials saved
  var supabaseUrl = PROPERTIES.getProperty('SUPABASE_URL');
  var mcpToken = PROPERTIES.getProperty('MCP_TOKEN');
  var aiApiKey = PROPERTIES.getProperty('AI_API_KEY');

  if (!supabaseUrl || !mcpToken || !aiApiKey) {
    var messageId = (e && e.gmail && e.gmail.messageId) ? e.gmail.messageId : '';
    return buildSettingsCard(messageId);
  }

  return buildMainCard(e);
}

/**
 * Builds the main card with the "Extract Tasks" button.
 */
function buildMainCard(e) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('TaskTriage')
      .setSubtitle('AI Task Extraction')
      .setImageUrl('https://raw.githubusercontent.com/jbrownsberger/Commitments/main/public/logo.png'));

  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText('Extract actionable tasks from this email and save them to your Commitments inbox.'));

  var messageId = (e && e.gmail && e.gmail.messageId) ? e.gmail.messageId : '';
  
  var extractAction = CardService.newAction()
    .setFunctionName('extractTasksFromEmail')
    .setParameters({ messageId: messageId, mode: "email" });
  var extractButton = CardService.newTextButton()
    .setText('Extract from Email')
    .setOnClickAction(extractAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor('#4F6B5E');

  var settingsAction = CardService.newAction()
    .setFunctionName('openSettings')
    .setParameters({ messageId: messageId });
  var settingsButton = CardService.newTextButton()
    .setText('Settings')
    .setOnClickAction(settingsAction)
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT);

  var buttonSet = CardService.newButtonSet()
    .addButton(extractButton)
    .addButton(settingsButton);
  section.addWidget(buttonSet);
  card.addSection(section);

  var customSection = CardService.newCardSection()
    .setHeader("Advanced Options");
    
  var manualAction = CardService.newAction()
    .setFunctionName('draftManualTask')
    .setParameters({ messageId: messageId });
  var manualButton = CardService.newTextButton()
    .setText('Draft Manual Task')
    .setOnClickAction(manualAction)
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT);
  customSection.addWidget(manualButton);

  var customTextInput = CardService.newTextInput()
    .setFieldName('custom_text')
    .setTitle('Or paste specific text to extract from:')
    .setMultiline(true);
  customSection.addWidget(customTextInput);
  
  var extractTextAction = CardService.newAction()
    .setFunctionName('extractTasksFromEmail')
    .setParameters({ messageId: messageId, mode: "text" });
  var extractTextButton = CardService.newTextButton()
    .setText('Extract from Text')
    .setOnClickAction(extractTextAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor('#4F6B5E');
  customSection.addWidget(extractTextButton);
  
  card.addSection(customSection);

  return card.build();
}

/**
 * Action triggered by "Extract Tasks" button.
 */
function extractTasksFromEmail(e) {
  var mode = (e.parameters && e.parameters.mode) || "email";
  var subject = "";
  var body = "";
  
  if (mode === "text") {
    body = (e.formInput && e.formInput.custom_text) ? e.formInput.custom_text : "";
    if (!body.trim()) {
      return CardService.newActionResponseBuilder()
        .setNotification(CardService.newNotification().setText("Please paste some text first."))
        .build();
    }
  } else {
    var messageId = (e.parameters && e.parameters.messageId) ? e.parameters.messageId : e.gmail.messageId;
    var accessToken = e.gmail.accessToken;
    GmailApp.setCurrentMessageAccessToken(accessToken);
    
    var message = GmailApp.getMessageById(messageId);
    subject = message.getSubject();
    body = message.getPlainBody();
  }
  
  // Call AI to extract tasks
  var tasks = [];
  try {
    tasks = getTasksFromAI(subject, body);
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText(err.message))
      .build();
  }
  
  if (!tasks || tasks.length === 0) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("No tasks found."))
      .build();
  }
  
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildTaskReviewCard(tasks)))
    .build();
}

function draftManualTask(e) {
  var emptyTask = {
    name: "",
    notes: "",
    priority: "med",
    due_date: "",
    estimated_hours: 1,
    substeps: [],
    links: []
  };
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildTaskReviewCard([emptyTask])))
    .build();
}

function buildTaskReviewCard(tasks) {
  var categories = [];
  try {
    categories = getCategories();
  } catch (err) {
    Logger.log("Failed to load categories: " + err.message);
  }

  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Review Tasks'));
    
  tasks.forEach(function(task, index) {
    var section = CardService.newCardSection();
    
    var checkboxGroup = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.CHECK_BOX)
      .setFieldName("task_include_" + index)
      .addItem("Include this task", JSON.stringify(task), true);
    section.addWidget(checkboxGroup);

    var nameInput = CardService.newTextInput()
      .setFieldName("task_name_" + index)
      .setTitle("Task Name")
      .setValue(task.name || "");
    section.addWidget(nameInput);
    
    var catInput = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName("task_category_" + index)
      .setTitle("Category");
      
    if (categories.length === 0) {
      catInput.addItem("No categories found", "", true);
    } else {
      categories.forEach(function(cat, cIdx) {
        catInput.addItem(cat.name, cat.id, cIdx === 0);
      });
    }
    section.addWidget(catInput);

    var priorityInput = CardService.newSelectionInput()
      .setType(CardService.SelectionInputType.DROPDOWN)
      .setFieldName("task_priority_" + index)
      .setTitle("Priority");
    priorityInput.addItem("Low", "low", task.priority === "low");
    priorityInput.addItem("Medium", "med", task.priority !== "low" && task.priority !== "high");
    priorityInput.addItem("High", "high", task.priority === "high");
    section.addWidget(priorityInput);

    var dueInput = CardService.newDatePicker()
      .setFieldName("task_due_" + index)
      .setTitle("Due Date");
    if (task.due_date) {
      // Create date at noon UTC to avoid timezone shift issues on pure dates
      var parts = task.due_date.split('-');
      if (parts.length === 3) {
        var dateObj = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
        dueInput.setValueInMsSinceEpoch(dateObj.getTime());
      }
    }
    section.addWidget(dueInput);
    
    var hoursInput = CardService.newTextInput()
      .setFieldName("task_hours_" + index)
      .setTitle("Estimated Hours")
      .setValue(String(task.estimated_hours || task.estimatedHours || 1));
    section.addWidget(hoursInput);

    var notesInput = CardService.newTextInput()
      .setFieldName("task_notes_" + index)
      .setTitle("Notes")
      .setMultiline(true)
      .setValue(task.notes || "");
    section.addWidget(notesInput);
    
    var substepsText = "";
    if (task.substeps && task.substeps.length > 0) {
      task.substeps.forEach(function(s) {
        substepsText += s.text + "\n";
      });
    }
    var substepsInput = CardService.newTextInput()
      .setFieldName("task_substeps_" + index)
      .setTitle("Substeps (one per line)")
      .setMultiline(true)
      .setValue(substepsText.trim());
    section.addWidget(substepsInput);
    
    var linksText = "";
    if (task.links && task.links.length > 0) {
      task.links.forEach(function(l) {
        linksText += (l.label || "Link") + ": " + l.value + "\n";
      });
    }
    var linksInput = CardService.newTextInput()
      .setFieldName("task_links_" + index)
      .setTitle("Links (Label: URL)")
      .setMultiline(true)
      .setValue(linksText.trim());
    section.addWidget(linksInput);
    
    card.addSection(section);
  });
  
  var actionSection = CardService.newCardSection();
  var saveAction = CardService.newAction().setFunctionName('saveTasks');
  var saveButton = CardService.newTextButton()
    .setText('Save Selected Tasks')
    .setOnClickAction(saveAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor('#4F6B5E');
    
  actionSection.addWidget(saveButton);
  card.addSection(actionSection);
  
  return card.build();
}

/**
 * Action triggered by "Save Selected Tasks" button.
 */
function saveTasks(e) {
  var formInputs = e.formInput;
  var tasksToSave = [];
  
  // Extract checked tasks from form data
  Object.keys(formInputs).forEach(function(key) {
    if (key.indexOf('task_include_') === 0) {
      var index = key.replace('task_include_', '');
      var taskJson = formInputs[key];
      var val = Array.isArray(taskJson) ? taskJson[0] : taskJson;
      var task = JSON.parse(val);
      
      // Override with form inputs
      if (formInputs["task_name_" + index]) {
        var n = formInputs["task_name_" + index];
        task.name = Array.isArray(n) ? n[0] : n;
      }
      if (formInputs["task_category_" + index]) {
        var c = formInputs["task_category_" + index];
        task.category_id = Array.isArray(c) ? c[0] : c;
      }
      if (formInputs["task_priority_" + index]) {
        var p = formInputs["task_priority_" + index];
        task.priority = Array.isArray(p) ? p[0] : p;
      }
      if (formInputs["task_due_" + index]) {
        var d = formInputs["task_due_" + index];
        var dateObj = null;
        if (d.msSinceEpoch) {
          dateObj = new Date(Number(d.msSinceEpoch));
        } else if (typeof d === 'string') {
          if (d.indexOf('{') === 0) {
            try { var p = JSON.parse(d); if (p.msSinceEpoch) dateObj = new Date(Number(p.msSinceEpoch)); } catch(e){}
          }
          if (!dateObj && d.indexOf('-') > 0) {
            var parts = d.split('-');
            if (parts.length === 3) dateObj = new Date(parts[0], parts[1]-1, parts[2]);
          }
          if (!dateObj && !isNaN(Number(d))) {
            dateObj = new Date(Number(d));
          }
        } else if (e.commonEventObject && e.commonEventObject.formInputs && e.commonEventObject.formInputs["task_due_" + index]) {
           var di = e.commonEventObject.formInputs["task_due_" + index].dateInput;
           if (di && di.msSinceEpoch) dateObj = new Date(Number(di.msSinceEpoch));
        }
        
        if (dateObj && !isNaN(dateObj.getTime())) {
          task.due_date = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");
        }
      }
      if (formInputs["task_hours_" + index]) {
        var h = formInputs["task_hours_" + index];
        task.estimated_hours = parseFloat(Array.isArray(h) ? h[0] : h) || 1;
      }
      if (formInputs["task_notes_" + index]) {
        var nt = formInputs["task_notes_" + index];
        task.notes = Array.isArray(nt) ? nt[0] : nt;
      }
      if (formInputs["task_substeps_" + index]) {
        var s = formInputs["task_substeps_" + index];
        var sLines = (Array.isArray(s) ? s[0] : s).split('\n');
        task.substeps = [];
        sLines.forEach(function(line, i) {
          if (line.trim()) {
            task.substeps.push({ text: line.trim(), weight: 1, position: i + 1, done: false });
          }
        });
      }
      if (formInputs["task_links_" + index]) {
        var l = formInputs["task_links_" + index];
        var lLines = (Array.isArray(l) ? l[0] : l).split('\n');
        task.links = [];
        lLines.forEach(function(line) {
          if (line.trim()) {
            var parts = line.split(':');
            if (parts.length > 1) {
              var label = parts[0].trim();
              var value = parts.slice(1).join(':').trim();
              task.links.push({ type: "web", label: label, value: value });
            } else {
              task.links.push({ type: "web", label: "Link", value: line.trim() });
            }
          }
        });
      }
      
      tasksToSave.push(task);
    }
  });
  
  if (tasksToSave.length === 0) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("No tasks selected."))
      .build();
  }
  
  var supabaseUrl = PROPERTIES.getProperty('SUPABASE_URL');
  var mcpToken = PROPERTIES.getProperty('MCP_TOKEN');
  
  var successCount = 0;
  
  // Loop through tasks and call the MCP endpoint to create them
  try {
    tasksToSave.forEach(function(task) {
      var payload = {
        jsonrpc: "2.0",
        id: Utilities.getUuid(),
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            name: task.name,
            notes: task.notes || "",
            priority: task.priority || "med",
            category_id: task.category_id || null,
            due_date: task.due_date || null,
            estimated_hours: task.estimated_hours || task.estimatedHours || 1,
            links: task.links || [],
            substeps: task.substeps || []
          }
        }
      };
      
      var options = {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'Authorization': "Bearer " + mcpToken
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };
      
      var response = UrlFetchApp.fetch(supabaseUrl + "/functions/v1/mcp", options);
      var responseCode = response.getResponseCode();
      var responseBody = response.getContentText();
      
      if (responseCode !== 200) {
        throw new Error("HTTP Error " + responseCode + ": " + responseBody);
      }
      
      var json = JSON.parse(responseBody);
      if (json.error) {
        throw new Error("RPC Error: " + JSON.stringify(json.error));
      }
      if (json.result && json.result.isError) {
        throw new Error("Tool Error: " + JSON.stringify(json.result.content));
      }
      
      successCount++;
    });
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText("Save failed: " + err.message))
      .build();
  }
  
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("Saved " + successCount + " tasks successfully!"))
    .setNavigation(CardService.newNavigation().popToRoot())
    .build();
}

function getCategories() {
  var supabaseUrl = PROPERTIES.getProperty('SUPABASE_URL');
  var mcpToken = PROPERTIES.getProperty('MCP_TOKEN');
  
  var payload = {
    jsonrpc: "2.0",
    id: Utilities.getUuid(),
    method: "tools/call",
    params: {
      name: "list_categories",
      arguments: {}
    }
  };
  
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': "Bearer " + mcpToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  var response = UrlFetchApp.fetch(supabaseUrl + "/functions/v1/mcp", options);
  if (response.getResponseCode() === 200) {
    var json = JSON.parse(response.getContentText());
    if (json.result && !json.result.isError && json.result.content && json.result.content.length > 0) {
      var data = JSON.parse(json.result.content[0].text);
      return data.categories || [];
    }
  }
  return [];
}

/**
 * Uses Gemini AI API to extract tasks from the email text.
 */
function getTasksFromAI(subject, body) {
  var apiKey = PROPERTIES.getProperty('AI_API_KEY');
  var isClaude = apiKey.indexOf('sk-ant-') === 0;
  var isOpenAI = !isClaude && apiKey.indexOf('sk-') === 0;
  
  var prompt = "You are a helpful assistant that extracts actionable tasks from emails.\n" +
"Return a JSON object containing a single key \"tasks\" which is a JSON array of objects.\n" +
"Each object must have the following structure (include empty arrays/strings if not applicable):\n" +
"- \"name\": A concise, action-oriented title for the task (string)\n" +
"- \"notes\": A brief summary of context from the email (string)\n" +
"- \"priority\": Either \"low\", \"med\", or \"high\" (string)\n" +
"- \"due_date\": YYYY-MM-DD if a deadline is mentioned, else \"\" (string)\n" +
"- \"estimated_hours\": Estimated time to complete in hours, e.g. 1 or 0.5 (number)\n" +
"- \"links\": Array of objects like {\"type\": \"email\", \"label\": \"Sender\", \"value\": \"email@example.com\"} or \"web\" for URLs (array)\n" +
"- \"substeps\": Array of objects like {\"text\": \"Step 1\", \"weight\": 1} for breaking down the task (array)\n\n" +
"Do not use markdown blocks like ```json. Just return the raw JSON object.\n\n" +
"Email Subject: " + subject + "\n" +
"Email Body:\n" +
body.substring(0, 8000);

  var url, options;

  if (isClaude) {
    url = 'https://api.anthropic.com/v1/messages';
    options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: "You are a helpful assistant that extracts actionable tasks from emails. Return ONLY a valid JSON object containing a 'tasks' array. Do not include any conversational text.",
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    };
  } else if (isOpenAI) {
    url = 'https://api.openai.com/v1/chat/completions';
    options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': "Bearer " + apiKey },
      payload: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      }),
      muteHttpExceptions: true
    };
  } else {
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" + apiKey;
    options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    };
  }
  
  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();
    
    if (responseCode !== 200) {
      throw new Error("API Error (" + responseCode + "): " + responseBody);
    }
    
    var json = JSON.parse(responseBody);
    
    var text = "";
    if (isClaude) {
      if (json.content && json.content[0] && json.content[0].text) {
        text = json.content[0].text.trim();
      }
    } else if (isOpenAI) {
      if (json.choices && json.choices[0].message.content) {
        text = json.choices[0].message.content.trim();
      }
    } else {
      if (json.candidates && json.candidates[0].content.parts[0].text) {
        text = json.candidates[0].content.parts[0].text.trim();
      }
    }
    
    if (text) {
      if (text.indexOf('```json') === 0) text = text.substring(7);
      if (text.indexOf('```') === 0) text = text.substring(3);
      if (text.substring(text.length - 3) === '```') text = text.substring(0, text.length - 3);
      
      var parsed = JSON.parse(text.trim());
      return parsed.tasks || [];
    }
    return [];
  } catch (e) {
    throw new Error("AI Extraction Error: " + e.message);
  }
}

// ----------------------------------------------------------------------
// Settings UI
// ----------------------------------------------------------------------

function openSettings(e) {
  var messageId = (e && e.parameters && e.parameters.messageId) ? e.parameters.messageId : '';
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(buildSettingsCard(messageId)))
    .build();
}

function buildSettingsCard(messageId) {
  var card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('Configuration'));
    
  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText('Please configure your API connections.'));
    
  var supabaseUrlInput = CardService.newTextInput()
    .setFieldName('supabaseUrl')
    .setTitle('Supabase Project URL')
    .setHint('e.g. https://xyz.supabase.co')
    .setValue(PROPERTIES.getProperty('SUPABASE_URL') || '');
    
  var mcpTokenInput = CardService.newTextInput()
    .setFieldName('mcpToken')
    .setTitle('TaskTriage MCP Token')
    .setHint('Begins with cmt_...')
    .setValue(PROPERTIES.getProperty('MCP_TOKEN') || '');
    
  var aiApiKeyInput = CardService.newTextInput()
    .setFieldName('aiApiKey')
    .setTitle('AI API Key (Gemini, OpenAI, or Claude)')
    .setHint('Starts with sk- or sk-ant-')
    .setValue(PROPERTIES.getProperty('AI_API_KEY') || '');
    
  section.addWidget(supabaseUrlInput);
  section.addWidget(mcpTokenInput);
  section.addWidget(aiApiKeyInput);
  
  var saveAction = CardService.newAction().setFunctionName('saveSettings');
  if (messageId) {
    saveAction.setParameters({ messageId: messageId });
  }
  
  var saveButton = CardService.newTextButton()
    .setText('Save')
    .setOnClickAction(saveAction)
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor('#4F6B5E');
    
  section.addWidget(saveButton);
  card.addSection(section);
  
  return card.build();
}

function saveSettings(e) {
  var form = e.formInput;
  var messageId = (e && e.parameters && e.parameters.messageId) ? e.parameters.messageId : '';
  
  if (form.supabaseUrl) PROPERTIES.setProperty('SUPABASE_URL', form.supabaseUrl.trim());
  if (form.mcpToken) PROPERTIES.setProperty('MCP_TOKEN', form.mcpToken.trim());
  if (form.aiApiKey) PROPERTIES.setProperty('AI_API_KEY', form.aiApiKey.trim());
  
  var dummyE = { gmail: { messageId: messageId } };
  
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText("Settings saved!"))
    .setNavigation(CardService.newNavigation().popToRoot().updateCard(buildMainCard(dummyE)))
    .build();
}
