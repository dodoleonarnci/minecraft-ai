
# How to Create The Customized Plugins

Plugins is a feature introduced by Minecraft AI and it has been submitted as a pull request to MINDcraft. Thus you can experience this feature in MINDcraft as well once it is accepted. The plugin mechanism is designed to easily add new actions and additional functions to AI characters without modifying the core implementations of Minecraft AI (same to the MINDcraft as well). Thus it is the recommended approach when you are planning to teach the AI characters some new and awesome skills. In this tutorial, you will know how to make a plugin and enable it in the game.

# Structure of Plugin

A plugin should be organized in an independent directory under `src`, whose name will be recoganized as the name of the plugin. Inside the plugin directory, only `main.js` file is compulsory. For example, the `Dance` plugin looks like 

```
src
|- Dance
|   |- main.js
```

In `main.js`, it should define and export a class named `PluginInstance`, which holds all the function for your plugin.

# PluginInstance

To define a valid `PluginInstance`, you shuld pay attention to three member functions: `constructor`, `init` and `getPluginActions`, as these functions will be called when the plugin is loaded.

## Constructor

The `constructor` of new plugin should take exactly one argument, the `agent`, through which you can access all necessary functions of the AI characters in Minecraft AI. 

## Initialization

The plugin should contains a member function `init()` without any arguments, and perform the initialization works here.

## Get Plugin Actions 

The plugin should contains a member function `getPluginActions()` without any arguments, and return a list of actions defined in the same format with those in `actionsList` of `src/agent/commands/actions.js`.

# Enabling Plugins 

Plugins are only loaded if their names are explicitly listed in the `settings.plugins` array. If the plugin name is not included, it will be ignored. For example, with the following setting, it enables two plugins `Dance` and `BuildWithBlueprint`.

```
plugins = ["Dance", "BuildWithBlueprint"]
```

# Example Code

Here is the code of the `Dance` plugin, which is given as an example. Feel free to modify it as you want to let AI characters doing fantastic dances.

```
export class PluginInstance {
    constructor(agent) {
        this.agent = agent;
    }

    init() {
    }

    getPluginActions() {
        return [
            {
                name: '!dancePoping',
                description: 'Dance poping.',
                params: {
                    'duration': {type: 'int', description: 'The time duration (in millions seconds, i.e. 1000 for 1 second) of dancing.'},
                },
                perform : async function(agent, duration) {
                    let result = "";
                    const actionFn = async (agent, duration) => {
                        agent.bot.chat("I am dancing~");
                        agent.bot.setControlState("jump", true);
                        await new Promise((resolve) => setTimeout(resolve, duration));
                        agent.bot.setControlState("jump", false);
                    }
                    await agent.actions.runAction('action:dance', actionFn);
                    return result;
                }
            },
        ]
    }
}
```