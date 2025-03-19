#!/bin/bash

# Ensure an argument is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <input_file>"
    exit 1
fi

INPUT_FILE="$1"
TEMP_FILE="processed_file.txt"

# Ensure the input file exists
if [ ! -f "$INPUT_FILE" ]; then
    echo "Error: File '$INPUT_FILE' not found!"
    exit 1
fi

# Create and execute an embedded Python script
python3 - <<EOF
import sys
import os

def process_file(input_filename, output_filename):
    try:
        with open(input_filename, "r", encoding="utf-8", errors="ignore") as infile:
            lines = infile.readlines()

        # Remove embedded icons and non-printable characters
        cleaned_lines = [line.encode("ascii", "ignore").decode("ascii") for line in lines]

        # Extract the filename from the full path
        filename = os.path.basename(input_filename)

        # Add a header with the filename and line numbers
        with open(output_filename, "w", encoding="utf-8") as outfile:
            outfile.write(f"=== Processed File: {filename} ===\n\n")
            for i, line in enumerate(cleaned_lines, start=1):
                outfile.write(f"{i}: {line}")  # Line numbers without leading zeros

        print(f"File processed successfully: {output_filename}")

    except Exception as e:
        print(f"Error processing file: {e}")
        sys.exit(1)

process_file("$INPUT_FILE", "$TEMP_FILE")
EOF

# Remove embedded icons and non-ASCII characters while preserving spaces and tabs
cat "$TEMP_FILE" | iconv -c -f utf-8 -t ascii | tr -cd '\11\12\15\40-\176' > "cleaned_$TEMP_FILE"

# Print the cleaned file with a monospaced font
lp -o 'landscape' -o 'sides=one-sided' -o 'cpi=10' -o 'lpi=6' "cleaned_$TEMP_FILE"

# Cleanup temporary files
rm -f "$TEMP_FILE" "cleaned_$TEMP_FILE"

echo "Processing and printing completed successfully."
