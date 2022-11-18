const fs = require("fs");
const exec = require("child_process").exec;

const _RESET = "\x1b[0m";
const _RED = "\x1b[31m";
const _GREEN = "\x1b[32m";
const _YELLOW = "\x1b[33m";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const pokemons = fs.readFileSync("../everypokemon.csv", "utf8").split("\n");
const tlds = fs.readFileSync("TLDs.txt", "utf8").split("\n");

pokemons.shift(); // Remove CSV header
pokemons.pop(); // Remove trailing empty line
tlds.shift(); // Remove introductory comment

const pokemon_count = pokemons.length;
const tld_count = tlds.length;

console.log("Loaded", pokemon_count, "Pokémon");
console.log("...and", tld_count, "TLDs");
console.log("---------------");

const pokemondomains = {};
const CSVpokemondomains = [];

// Requires jschauma's jswhois
// Available at: github.com/jschauma/jswhois
pokemons.forEach((num_pk, i) => {
  const pokemon_index = Number(num_pk.split(",")[0]) || -1;
  const orig_pokemon = num_pk.split(",")[1];
  // Normalize (e.g. "Flabébé" -> "flabebe")
  pokemon = orig_pokemon
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]/gi, "");

  tlds.forEach(tld => {
    tld = tld.toLowerCase();
    if(!pokemon.endsWith(tld))
      return;
    if(tld.length <= 0)
      return;
    if(pokemon.length - tld.length <= 0)
      return;
    // If we got here, oh boy! We caught one!

    // Inserts '.' to create a domain name (e.g. "flabebe" to "flabe.be")
    const lastindex = pokemon.lastIndexOf(tld);
    const domain = `${pokemon.slice(0, lastindex)}.${tld}`;

    pokemondomains[domain] = null;
    if(orig_pokemon.indexOf(",") >= 0) {
      CSVpokemondomains.push([
        pokemon_index, `"${orig_pokemon}",${tld.toUpperCase()},${domain}`
      ]);
    } else {
      CSVpokemondomains.push([
        pokemon_index, `${orig_pokemon},${tld.toUpperCase()},${domain}`
      ]);
    }

    // Lookup domain with WHOIS
    sleep(75 * i).then(() => {
      exec(`timeout 180s jswhois ${domain}`, (error, stdout, stderr) => {
        if(error) {
          console.log(`${_YELLOW}ERROR${_RESET} ${domain} :(`);
          pokemondomains[domain] = "ERROR";
          return;
        }
        processDomain(JSON.parse(stdout));
      });
    });

    if(tld.length > 2) {
      // We've been missing .buzz because whois.iana.org
      // doesn't recurse to whois.nic.buzz...
      sleep(75 * i).then(() => {
        exec(`timeout 180s jswhois -h whois.nic.${tld} ${domain}`, (error, stdout, stderr) => {
          if(error) return;
          processDomain(JSON.parse(stdout));
        });
      });
    }
  });
});

let last_count = -1;
function waitloop() {
  const heldup = Object.values(pokemondomains).filter(v => v === null).length;
  if(heldup > 0) {
    if(last_count !== heldup) {
      last_count = heldup;
      if(heldup === 1) {
        for(let k in pokemondomains) {
          if(pokemondomains[k] === null) {
            console.log("Waiting for", k);
            break;
          }
        }
      } else console.log("Waiting for", heldup, "domains");
    }
    setTimeout(waitloop, 1500);
  } else {
    console.log("---------------");

    const current_datetime = (new Date()).toISOString();

    const stream1 = fs.createWriteStream("../pokemondomains.csv");
    stream1.write(`# Last updated: ${current_datetime}\n`);
    stream1.write(`number,pokemon,tld,domain\n`);
    CSVpokemondomains.sort((a, b) => a[0] - b[0]);
    stream1.write(
      CSVpokemondomains.map(p => `${p[0]},${p[1]}`).join("\n")
    );
    stream1.end();

    const stream2 = fs.createWriteStream("../pokemondomains+status.csv");
    stream2.write(`# Last updated: ${current_datetime}\n`);
    stream2.write(`domain,status\n`);
    const errors = [];
    const final = [];
    for(let key in pokemondomains) {
      final.push(`${key},${pokemondomains[key]}`);
      if(pokemondomains[key] === "EMPTY"
      || pokemondomains[key] === "ERROR") {
        errors.push(key);
      }
    }
    final.sort();
    stream2.write(final.join("\n"));
    stream2.end();

    console.log(`Wrote ${final.length} domains to two files!`);

    if(errors.length) {
      console.log("The following domains should probably be retried manually:")
      console.log(errors.join(", "));
    }
  }
}
waitloop();


// ------------------

function processDomain(data) {
  const domain = data.query;
  if(pokemondomains[domain] === "TAKEN") {
    return;
  }

  const lookfor = [
    "created", "creator", "creationdate",
    "expire", "expires", "expirydate",
    "changed", "status",
    "updateddate", "lastupdated", "lastmodified",
    "registered",
    "registrar",
    "registrarname",
    "registrarcountry",
    "registrarurl",
    "registryexpirydate",
    "nameserver", "nameservers",
    "dnssec",
    "email",
    "person"
  ];

  let found = false;

  for(let whois of data.chain) {
    if(whois === "whois.iana.org")
      continue;
    if(found)
      break;

    if(Object.keys(data[whois]).length === 0) {
      // articu.no was returning empty *SOMETIMES*
      console.log(`${_YELLOW}EMPTY${_RESET} ${domain}`);
      pokemondomains[domain] = "EMPTY";
      return;
    }
    for(const dmn of ["Domain", "domain", "DOMAIN"]) {
      if(dmn in data[whois] && typeof data[whois].domain === "object") {
        const { [dmn]: d, ...rest } = data[whois];
        data[whois] = { ...d, ...rest };
        break;
      }
    }
    for(let orig_key of Object.keys(data[whois])) {
      if(found)
        break;

      const key = lowercaseASCII(orig_key);
      const value = lowercaseASCII(data[whois][orig_key]);
      if(lookfor.includes(key)) {
        //console.log(`[${data.query}] Found in ${whois} '${orig_key}': ${value}`);

        // Skip "status: free" and "status: available" from consideration
        // Only seen this on .de domains
        if(key === "status" && ["available", "free"].includes(value)) {
          continue;
        } else found = true;
      }
    }
  }

  if(!found) {
    const { "chain": _1, "query": _2, "whois.iana.org": _3, ...res } = data;
    if(Object.keys(res).length === 0)
      console.log(`${_GREEN}AVAIL${_RESET} ${domain}`);
    else {
      console.log(domain, res);
      console.log();
    }
    pokemondomains[domain] = "AVAIL";
  } else {
    console.log(`${_RED}TAKEN${_RESET} ${domain}`);
    pokemondomains[domain] = "TAKEN";
  }
}

function lowercaseASCII(str) {
  if(typeof str === "object") str = JSON.stringify(str);
  return str.trim().toLowerCase().normalize("NFKD").replace(/[^a-z]/gi, "");
}

