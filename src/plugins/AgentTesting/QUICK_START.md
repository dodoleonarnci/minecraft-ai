# AgentTesting Plugin - Quick Start Guide

## 5-Minute Setup

### Step 1: Enable the Plugin (30 seconds)

Edit `settings.js`:

```javascript
{
  "plugins": ["AgentTesting"],
  // ... rest of your settings
}
```

### Step 2: Choose a Testing Method (pick one)

#### Option A: Automatic Testing (Recommended)

Edit your agent profile (e.g., `lucy.json`):

```json
{
  "name": "lucy",
  "model": "gpt-4o",
  "test_config": {
    "task_id": "simple_debug",
    "auto_start": true
  }
}
```

Run: `node main.js`

The agent will automatically run the test on spawn!

#### Option B: Manual Testing

Run: `node main.js`

In Minecraft chat, type:
```
!quickTest simple_debug
```

### Step 3: Check Results

Results are saved to: `bots/{agent_name}/test_results/latest.json`

```bash
cat bots/lucy/test_results/latest.json
```

---

## Available Test Tasks

Run `!listTestTasks` in-game to see all available tasks, or choose from:

1. **simple_debug** - ⚡ Quick test (60s) - Best for first time testing
2. **gather_wood** - 🌲 Gather and craft wood (300s)
3. **craft_tools** - 🔨 Craft wooden tools (180s)
4. **mining_stone** - ⛏️ Mine cobblestone (300s)
5. **smelting_iron** - 🔥 Smelt iron ingots (300s)
6. **build_shelter** - 🏠 Build a shelter (600s)
7. **food_gathering** - 🥩 Hunt and gather food (300s)
8. **navigation_test** - 🧭 Navigate to coordinates (600s)

---

## Common Commands

```bash
# List all tasks
!listTestTasks

# Quick test (one command)
!quickTest simple_debug

# Manual workflow
!loadTestTask gather_wood
!setupTestEnvironment
!startTest
!testStatus
!endTest true

# Check results (in terminal)
cat bots/lucy/test_results/latest.json | jq '.success'
```

---

## Creating Your Own Task

1. Copy an existing task from `src/plugins/AgentTesting/tasks/`
2. Edit the JSON file with your task details
3. Save it in the `tasks/` directory
4. Run: `!quickTest your_task_id`

---

## Troubleshooting

### "No tasks available"
- Check files exist in `src/plugins/AgentTesting/tasks/`
- Restart the agent

### "Failed to setup environment"
- Make sure agent has OP permissions: `/op agent_name`
- Enable cheat mode in task config: `"enable_cheat_mode": true`

### Test never completes
- Check timeout in task config
- Use `!testStatus` to check current state
- Manually end with `!endTest false`

---

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Create custom tasks for your specific testing needs
- Integrate with evaluation_script.py for batch testing
- Explore advanced features like success criteria monitoring

---

Happy Testing! 🎮🤖
