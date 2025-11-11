import sys
import re
from datetime import datetime

timestamp_pat = re.compile(r'((⟦)?\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(⟧)?)')
now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def update_file(filename):
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            content = f.read()
        new_content, n = timestamp_pat.subn(lambda m: f"{m.group(2) or ''}{now}{m.group(3) or ''}", content)
        if n > 0 and new_content != content:
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated: {filename}")
    except Exception as e:
        print(f"Error processing {filename}: {e}")

if __name__ == "__main__":
    for f in sys.argv[1:]:
        update_file(f)
