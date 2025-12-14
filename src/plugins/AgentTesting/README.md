# AgentTesting Plugin

A comprehensive testing framework plugin for Minecraft AI agents that allows you to define, configure, and execute automated tests in specific Minecraft world seeds with controlled starting conditions.

## Overview

The AgentTesting plugin provides a non-invasive way to test agent behaviors in controlled environments. It supports:

- **Task-based testing** with predefined goals and success criteria
- **Environment setup** including teleportation, inventory management, and world seed specification
- **Automated test execution** with timeout handling and success monitoring
- **Result tracking** with detailed JSON output for analysis
- **Integration with existing evaluation frameworks** (compatible with evaluation_script.py)

## Features

✅ **No Core Code Modification** - Pure plugin implementation using the existing plugin system
✅ **Flexible Task Configuration** - JSON-based task definitions
✅ **Automated Environment Setup** - Teleportation, inventory clearing, item giving
✅ **Success Criteria Monitoring** - Automatic detection of task completion
✅ **Timeout Management** - Configurable timeouts for long-running tasks
✅ **Detailed Result Logging** - JSON output with full test metadata
✅ **Multiple Integration Methods** - CLI, profile configuration, or in-game commands
✅ **Seed Coordination Support** - Specify exact coordinates for reproducible testing

---

## Installation

1. **Enable the plugin in settings.js:**

```javascript
{
  "plugins": ["AgentTesting"],
  // ... other settings
}
```

2. **Restart your Minecraft AI agent**

The plugin will automatically create the necessary directories on first run.

---

## Quick Start

### Method 1: Automatic Test (via Agent Profile)

Add test configuration to your agent's profile JSON file:

```json
{
  "name": "test_agent",
  "model": "gpt-4o",
  "test_config": {
    "task_id": "gather_wood",
    "auto_start": true
  }
}
```

Then run:
```bash
node main.js
```

The agent will automatically load, setup, and start the test on spawn.

### Method 2: Manual Commands (in Minecraft chat)

```
!listTestTasks                        # See available tasks
!loadTestTask gather_wood             # Load a task by ID
!setupTestEnvironment                 # Setup environment
!startTest                            # Start the test
!testStatus                           # Check test status
!endTest true                         # Manually end test (success)
```

### Method 3: Quick Test (One Command)

```
!quickTest gather_wood                # Load, setup, and start in one command
```

---

## Task Configuration

Tasks are defined in JSON files located in `src/plugins/AgentTesting/tasks/`. Each task file follows this schema:

### Complete Task Schema

```json
{
  "task_id": "unique_task_identifier",
  "description": "Human-readable description of what this task tests",
  "seed": "minecraft_world_seed",
  "world_name": "descriptive_world_name",

  "goal": "The primary objective the agent should accomplish",

  "starting_prompt": "Detailed instructions sent to the agent at test start",

  "starting_inventory": {
    "item_name": quantity,
    "wooden_axe": 1,
    "apple": 5
  },

  "teleport_coordinates": {
    "x": 100,
    "y": 64,
    "z": -200,
    "dimension": "overworld"
  },

  "test_config": {
    "timeout_seconds": 300,
    "enable_cheat_mode": true,
    "reset_inventory": true,
    "success_criteria": {
      "required_items": {
        "item_name": minimum_quantity
      }
    }
  }
}
```

### Field Descriptions

#### Core Fields

- **task_id** (required): Unique identifier for the task
- **description**: Human-readable description (for documentation)
- **seed**: Minecraft world seed (for reproducibility)
- **world_name**: Descriptive name for the test world
- **goal** (required): Primary objective description

#### Starting Conditions

- **starting_prompt**: Detailed instructions sent to agent at test start
  - If not provided, uses `goal` as the prompt
- **starting_inventory**: Dictionary of items to give the agent
  - Format: `{"item_name": quantity}`
  - Items are given using `/give` commands
- **teleport_coordinates**: Where to teleport the agent at test start
  - **x, y, z**: Coordinate values
  - **dimension**: "overworld", "the_nether", or "the_end"

#### Test Configuration

- **test_config.timeout_seconds**: Maximum test duration (0 or null = no timeout)
- **test_config.enable_cheat_mode**: Enable cheat mode for instant actions
- **test_config.reset_inventory**: Clear inventory before giving starting items
- **test_config.success_criteria**: Conditions for automatic test success
  - **required_items**: Dictionary of items that must be in inventory
    - Test passes when ALL items meet minimum quantities

---

## Example Tasks

### 8 Included Example Tasks:

1. **gather_wood** - Gather oak logs and craft planks
2. **build_shelter** - Build a 5x5 shelter structure
3. **craft_tools** - Craft a complete set of wooden tools
4. **mining_stone** - Mine cobblestone blocks
5. **smelting_iron** - Smelt raw iron into iron ingots
6. **food_gathering** - Hunt animals and collect meat
7. **navigation_test** - Navigate to specific coordinates
8. **simple_debug** - Simple task for testing plugin functionality

### Example: Creating a Custom Task

Create a new file `src/plugins/AgentTesting/tasks/my_custom_task.json`:

```json
{
  "task_id": "my_custom_task",
  "description": "Test agent's ability to craft a stone pickaxe",
  "goal": "Craft one stone pickaxe from scratch",

  "starting_prompt": "You are in a plains biome. Craft a stone pickaxe. You'll need to: 1) Gather wood, 2) Craft a wooden pickaxe, 3) Mine stone, 4) Craft a stone pickaxe.",

  "starting_inventory": {},

  "teleport_coordinates": {
    "x": 0,
    "y": 70,
    "z": 0
  },

  "test_config": {
    "timeout_seconds": 600,
    "enable_cheat_mode": true,
    "reset_inventory": true,
    "success_criteria": {
      "required_items": {
        "stone_pickaxe": 1
      }
    }
  }
}
```

---

## Available Commands

The plugin provides the following in-game commands (accessible to the agent):

| Command | Parameters | Description |
|---------|-----------|-------------|
| `!loadTestTask` | task_identifier | Load a task by ID or file path |
| `!setupTestEnvironment` | none | Setup test environment (teleport, inventory) |
| `!startTest` | none | Start the loaded test |
| `!endTest` | success (boolean) | Manually end the test |
| `!testStatus` | none | Get current test status |
| `!listTestTasks` | none | List all available tasks |
| `!quickTest` | task_identifier | Load, setup, and start in one command |

---

## Test Results

Results are automatically saved to `bots/{agent_name}/test_results/` in JSON format.

### Result File Structure

```json
{
  "task_id": "gather_wood",
  "agent_name": "test_agent",
  "start_time": "2024-01-15T10:30:00.000Z",
  "end_time": "2024-01-15T10:35:23.000Z",
  "duration_seconds": 323,
  "success": true,
  "termination_reason": "success_criteria_met",
  "goal": "Gather 10 oak logs and craft them into 40 oak planks",
  "initial_inventory": {
    "wooden_axe": 1,
    "apple": 3
  },
  "final_inventory": {
    "oak_planks": 48,
    "wooden_axe": 1,
    "apple": 3,
    "oak_log": 2
  },
  "final_position": {
    "x": 105.3,
    "y": 64.0,
    "z": -195.7
  },
  "actions_taken": 0
}
```

### Result Files

- **Timestamped files**: `{task_id}_{timestamp}.json` - Full history of all test runs
- **Latest file**: `latest.json` - Always contains the most recent test result

---

## Integration with evaluation_script.py

The plugin is compatible with the existing evaluation framework. It writes completion codes to agent memory in the same format:

- **Success**: `code : 2`
- **Failure**: `code : 4`

This allows evaluation_script.py to detect test completion using its existing logic.

### Example Integration

```python
# evaluation_script.py can check test results
result_path = f"bots/{agent_name}/test_results/latest.json"
with open(result_path, 'r') as f:
    result = json.load(f)

if result['success']:
    print(f"Test {result['task_id']} passed in {result['duration_seconds']}s")
else:
    print(f"Test failed: {result['termination_reason']}")
```

---

## Advanced Usage

### Using with Command Line Arguments

You can extend main.js or agent profiles to accept task configuration via command line:

```bash
node main.js --profiles ./test_agent.json
```

Where `test_agent.json` contains:

```json
{
  "name": "test_agent",
  "model": "gpt-4o",
  "test_config": {
    "task_file": "./src/plugins/AgentTesting/tasks/gather_wood.json",
    "auto_start": true
  }
}
```

### Loading Tasks by File Path

```javascript
// In Minecraft chat:
!loadTestTask ./src/plugins/AgentTesting/tasks/custom_task.json
```

### Manual Success Checking

If you don't want automatic success criteria monitoring, set `success_criteria` to `null`:

```json
{
  "test_config": {
    "success_criteria": null
  }
}
```

Then manually end the test:
```
!endTest true    // success
!endTest false   // failure
```

---

## Cheat Mode

When `enable_cheat_mode` is true, the plugin enables the "cheat" mode which allows:

- Instant teleportation via `/tp` commands
- Use of operator commands like `/give`, `/clear`
- Faster block placement and breaking

This is useful for:
- Setting up test environments quickly
- Skipping unnecessary grinding
- Focusing tests on specific behaviors

To use cheat mode, ensure your agent has operator permissions on the Minecraft server.

---

## Troubleshooting

### Plugin Not Loading

**Problem**: Plugin doesn't appear to be active
**Solution**:
1. Check that `"AgentTesting"` is in `settings.plugins` array
2. Restart the agent process
3. Check console for initialization messages: `[AgentTesting] Initializing plugin...`

### Tasks Not Found

**Problem**: `!listTestTasks` shows "No tasks available"
**Solution**:
1. Check that task JSON files exist in `src/plugins/AgentTesting/tasks/`
2. Verify JSON files are valid (use a JSON validator)
3. Ensure each task file has a `task_id` field

### Environment Setup Fails

**Problem**: Teleport or item giving doesn't work
**Solution**:
1. Ensure agent has operator permissions (`/op agent_name`)
2. Check that `enable_cheat_mode` is true
3. Verify Minecraft server allows cheats
4. Check console for error messages

### Test Never Completes

**Problem**: Test runs forever, doesn't auto-complete
**Solution**:
1. Check if timeout is set in `test_config.timeout_seconds`
2. Verify success criteria items are spelled correctly
3. Monitor agent's inventory to see if criteria are being met
4. Use `!testStatus` to check current state
5. Manually end with `!endTest false` if stuck

### Results Not Saving

**Problem**: No result files appear
**Solution**:
1. Check that `bots/{agent_name}/test_results/` directory exists
2. Verify write permissions on the directory
3. Check console for save errors
4. Ensure test actually ended (not still running)

---

## Future Enhancements

Potential additions to the plugin:

- **Position-based success criteria** - Check if agent reaches certain coordinates
- **Time-based challenges** - Tasks with specific time requirements
- **Multi-agent testing** - Coordinate tests across multiple agents
- **Custom success functions** - JavaScript evaluation for complex criteria
- **Screenshot capture** - Take screenshots at test completion
- **Replay functionality** - Record and replay agent actions
- **Comparative analysis** - Compare results across multiple runs
- **Web dashboard** - Visual interface for test management

---

## Contributing

To add new features or task examples:

1. Fork the repository
2. Add your task files to `src/plugins/AgentTesting/tasks/`
3. Update this README with documentation
4. Test thoroughly with various agent models
5. Submit a pull request

---

## License

This plugin is part of the Minecraft AI project and follows the same license as the main repository.

---

## Credits

Created as part of the Minecraft AI agent testing framework. Built on top of:
- **Mineflayer** - Minecraft bot framework
- **MINDcraft** - Foundation for the Minecraft AI system
- **Generative Agents** - Autonomous AI agent concepts

---

## Support

For issues, questions, or suggestions:

1. Check the troubleshooting section above
2. Review example tasks for correct configuration
3. Check console logs for error messages
4. File an issue on the project repository

---

## Changelog

### Version 1.0.0 (Initial Release)

- Core plugin implementation
- Task loading and configuration system
- Environment setup (teleport, inventory management)
- Automated test execution
- Success criteria monitoring
- Result tracking and saving
- Integration with existing evaluation framework
- 8 example tasks covering common scenarios
- Comprehensive documentation

---

Happy Testing! 🎮🤖
