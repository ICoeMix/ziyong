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

        # 只替换已有的 ⟦TIMESTAMP⟧ 格式
        new_content = timestamp_pat.sub(f'⟦{now}⟧', content)

        # 如果内容有变化，写回文件
        if new_content != content:
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Updated timestamp in: {filename}")
    except Exception as e:
        print(f"Error processing {filename}: {e}")

if __name__ == "__main__":
    for file in sys.argv[1:]:
        update_file(file)
