# -*- coding: utf-8 -*-
import urllib.request
import unicodedata
import json
import re

def strip_accents(s):
   return "".join(
    c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
  )

bulbaurl = "https://bulbapedia.bulbagarden.net/w/api.php?action=parse&page=List_of_Pok%C3%A9mon_by_National_Pok%C3%A9dex_number&prop=wikitext&format=json"
req = urllib.request.Request(bulbaurl, headers={ "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.0000.00 Safari/537.36" }) 
con = urllib.request.urlopen(req)
jsonresp = json.loads(con.read())
wikitext = jsonresp["parse"]["wikitext"]["*"]

result = re.findall(r"{{ndex\|([0-9\-]+)\|([^\|]+)\|[^}]+}}", wikitext)
print("Found", len(result), "Pokémon")

filtered = []

prev = -1
for i in range(len(result)):
  if result[i][0] != "---":
    index = int(result[i][0])
    if index == prev:
      continue
    prev = index
  else:
    index = "N/A"
    prev = -1
  pokename = result[i][1]

  # Escape double quotes (if there ever is one)
  if '"' in pokename:
    pokename = pokename.replace('"', '\\"')

  # Escape names with commas (if there ever is one)
  if "," in pokename:
    filtered.append(f"{index},\"{pokename}\"\n")
  else:
    filtered.append(f"{index},{pokename}\n")

print("Fixed to", len(filtered), "Pokémon")

with open("../everypokemon.csv", "w", encoding="utf-8") as file:
  file.write("number,pokémon\n")
  file.writelines(filtered)

print("Wrote to file")