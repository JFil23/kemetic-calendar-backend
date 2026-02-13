#!/usr/bin/env python3
"""
Show ALL decan information - descriptions from calendar_page.dart and flows from kemetic_day_info.dart
"""

import re

# Read decan descriptions from calendar_page.dart
with open('mobile/lib/features/calendar/calendar_page.dart', 'r', encoding='utf-8') as f:
    calendar_content = f.read()

# Extract _decanInfo array
start_idx = calendar_content.find('const List<String> _decanInfo = [')
end_idx = calendar_content.find('];', start_idx)
info_section = calendar_content[start_idx:end_idx+2]

# Extract all descriptions
all_descriptions = []
for line in info_section.split('\n'):
    line = line.strip()
    if line.startswith("'") and ('—' in line or '(' in line):
        # Clean up the line
        line = line.strip("',")
        if line:
            all_descriptions.append(line)

# Read kemetic_day_info.dart for flows
with open('mobile/lib/widgets/kemetic_day_info.dart', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract decan flows
decan_flows = {}
lines = content.split('\n')
current_decan = None
in_flow = False
flow_lines = []

for i, line in enumerate(lines):
    # Find decanName
    if 'decanName:' in line:
        match = re.search(r"decanName:\s*'([^']+)'", line)
        if match:
            current_decan = match.group(1)
            in_flow = False
            flow_lines = []
    
    # Find decanFlow start
    if current_decan and 'decanFlow:' in line:
        in_flow = True
        flow_lines = [line]
        continue
    
    # Collect flow lines
    if in_flow:
        flow_lines.append(line)
        if '],' in line or (']' in line and ',' in line and not line.strip().startswith('DecanDayInfo')):
            in_flow = False
            flow_text = '\n'.join(flow_lines)
            
            # Extract DecanDayInfo entries
            day_pattern = r"DecanDayInfo\(day:\s*(\d+),\s*theme:\s*'([^']+)',\s*action:\s*'([^']+)',\s*reflection:\s*'([^']+)'\)"
            days = re.findall(day_pattern, flow_text)
            
            if days:
                flow = []
                for day, theme, action, reflection in days:
                    flow.append({
                        'day': int(day),
                        'theme': theme,
                        'action': action,
                        'reflection': reflection
                    })
                
                # Store unique flows
                flow_key = tuple(sorted((d['day'], d['theme']) for d in flow))
                
                if current_decan not in decan_flows:
                    decan_flows[current_decan] = []
                
                # Check if this flow already exists
                exists = False
                for existing in decan_flows[current_decan]:
                    existing_key = tuple(sorted((d['day'], d['theme']) for d in existing))
                    if existing_key == flow_key:
                        exists = True
                        break
                
                if not exists:
                    decan_flows[current_decan].append(flow)

# Print everything
print("=" * 100)
print("COMPLETE DECAN INFORMATION - ALL NAMES AND DESCRIPTIONS")
print("=" * 100)
print(f"\nTotal decan descriptions: {len(all_descriptions)}")
print(f"Total decans with flows: {len(decan_flows)}")
print()

# Print all descriptions
print("\n" + "=" * 100)
print("ALL DECAN DESCRIPTIONS (from calendar_page.dart)")
print("=" * 100)
print()

for idx, desc_line in enumerate(all_descriptions, 1):
    print(f"{idx}. {desc_line}")
    print()

# Print all flows
print("\n" + "=" * 100)
print("ALL DECAN FLOWS (10-DAY PRACTICES from kemetic_day_info.dart)")
print("=" * 100)
print()

for decan_name in sorted(decan_flows.keys()):
    print(f"\n{'='*100}")
    print(f"DECAN: {decan_name}")
    print(f"{'='*100}")
    
    flows = decan_flows[decan_name]
    for flow_idx, flow in enumerate(flows, 1):
        if len(flows) > 1:
            print(f"\n  ─── Flow Variant {flow_idx} ───")
        for day_info in sorted(flow, key=lambda x: x['day']):
            print(f"\n    Day {day_info['day']}:")
            print(f"      Theme: {day_info['theme']}")
            print(f"      Action: {day_info['action']}")
            print(f"      Reflection: {day_info['reflection']}")

print(f"\n\n{'='*100}")
print("SUMMARY")
print(f"{'='*100}")
print(f"Total decan descriptions: {len(all_descriptions)}")
print(f"Total decans with 10-day flows: {len(decan_flows)}")
print(f"{'='*100}")




