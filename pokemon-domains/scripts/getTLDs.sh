#! /bin/bash

echo "Getting list of current TLDs from IANA..."
wget -O TLDs.txt http://data.iana.org/TLD/tlds-alpha-by-domain.txt
echo "Done :)"