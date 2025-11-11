import sys
import re
from datetime import datetime

# 匹配 ⟦YYYY-MM-DD HH:MM:SS⟧
timestamp_pat = re.compile(r'⟦\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}⟧')
now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def update_file(filename):
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            content = f.read()

        # 如果文件里已有时间戳，就替换
        if timestamp_pat.search(content):
            new_content = timestamp_pat.sub(f'⟦{now}⟧', content)
        else:
            # 没有时间戳就加在开头
            new_content = f'⟦{now}⟧\n{content}'

        if new_content != content:
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated timestamp in: {filename}")
        else:
            print(f"No change needed for: {filename}")

    except Exception as e:
        print(f"Error processing {filename}: {e}")

if __name__ == "__main__":
    # sys.argv[1:] 是文件列表
    for file in sys.argv[1:]:
        update_file(file)
