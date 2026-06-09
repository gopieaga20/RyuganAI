import os
import re

os.makedirs('frontend', exist_ok=True)
os.makedirs('backend', exist_ok=True)

with open('dalal-street-complete.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract CSS
style_match = re.search(r'<style>(.*?)</style>', content, re.DOTALL)
css_content = style_match.group(1).strip() if style_match else ""

# Extract JS
script_match = re.search(r'<script>(.*?)</script>(?=\s*</body>)', content, re.DOTALL)
js_content = script_match.group(1).strip() if script_match else ""

# Patch the JavaScript to use our local backend for the Yahoo Finance data
# 1) If the old targetUrl proxy block exists:
js_content = re.sub(
    r"const targetUrl = `https://query1\.finance\.yahoo\.com.*?`;\n\s*const url = `https://api\.allorigins\.win/raw\?url=\$\{encodeURIComponent\(targetUrl\)\}`;",
    r"const url = `http://localhost:8000/api/yahoo-chart/${encodeURIComponent(sym)}?interval=${tf}&range=${period}`;",
    js_content
)

# 2) If the original direct url block exists:
js_content = re.sub(
    r"const url = `https://query1\.finance\.yahoo\.com.*?`;",
    r"const url = `http://localhost:8000/api/yahoo-chart/${encodeURIComponent(sym)}?interval=${tf}&range=${period}`;",
    js_content
)

# Write out frontend files
with open('frontend/styles.css', 'w', encoding='utf-8') as f:
    f.write(css_content)

with open('frontend/script.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

# Remove the extracted parts from the HTML and link to external files
new_html = re.sub(r'<style>.*?</style>', '<link rel="stylesheet" href="styles.css">\n', content, flags=re.DOTALL)
new_html = re.sub(r'<script>.*?</script>(?=\s*</body>)', '<script src="script.js"></script>\n', new_html, flags=re.DOTALL)

with open('frontend/index.html', 'w', encoding='utf-8') as f:
    f.write(new_html)

print("Frontend Splitting and Setup Complete.")
