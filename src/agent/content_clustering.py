from sentence_transformers import SentenceTransformer, util
import json
import openai

categoryBase = {
    "building":"Let's build a house! I will build a church with oak planks and cobblestone. Let's light up this platform with torches. I ran out of wood, finding oak logs. Max, you build the walls, and I'll get started with the interior furniture.",
    "crafting":"Do you have any sticks? Oh, let me check my inventory to see if I have enought ingots. Let's find a crafting table. I have enough sticks to craft three diamond pickaxes, but do you have any diamonds. I only have eight planks, how many do you have? We need 6 sticks and 9 cobblestones. I can use this furnace and my coal to cook my raw beef. Do we have enough eggs? Is there enought iron ingots for this armor? Let's cook some more food.",
    "traveling":"I'm going to the other player. Follow me. Let's travel to the nether. Gonna head back to our base. Searching for wood logs right now. I can't find any ores nearby. Looking for some chickens. Heading to the coordinates you gave me.",
    "hunting":"Let's hunt down these sheep. I have to kill a lot of zombies. I have a stone sword to kill these pigs for pork. Time to attack!",
    "conversing":"Hi, my name is Steve. Hey Lucy, I'm Max. What do you want to do right now? I'm so bored, let's go do something.",
    "collecting":"Let's mine some stone. Now with an iron pickaxe, I can find some ores to mine. Finding wood to chop down, getting some oak logs. Searching for sand to collect. I'm trying to find some flowers. Still need to collect some more wood."
}

def embedding_sim(text1, text2):
    model = SentenceTransformer('all-MiniLM-L6-v2')

    embedding1 = model.encode(text1, convert_to_tensor=True)
    embedding2 = model.encode(text2, convert_to_tensor=True)

    cos_sim = util.pytorch_cos_sim(embedding1, embedding2)
    return float(cos_sim.item())

with open('../../bots/Max/memory.json', 'r') as file:
    data = json.load(file)
    
turns = data["turns"]
iterator = len(turns)-1
clusterTextLength = 3
turnsAdded = 0
clusterText = ""

# Clustering on at most the past three messages
while turnsAdded != clusterTextLength and iterator > 0:
    message = turns[iterator]["content"]
    if turns[iterator]["role"] == "assistant":
        clusterText += message + "\n"
        turnsAdded += 1
    elif turns[iterator]["role"] == "user":
        if "FROM OTHER BOT" in message:
            messageStart = message.find("FROM OTHER BOT") + 15
            clusterText += message[messageStart:] + "\n"
            turnsAdded += 1
    iterator -= 1
        
print(clusterText+"\n***\n")
for category in categoryBase:
    print(category, embedding_sim(categoryBase[category], clusterText))

