#!/usr/bin/env python3
"""
Extract all decan names, descriptions, and 10-day flow information
"""

import re

# Read the kemetic_day_info.dart file
with open('mobile/lib/widgets/kemetic_day_info.dart', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract all KemeticDayInfo entries
# Pattern to match each KemeticDayInfo block
info_pattern = r"KemeticDayInfo\(([^)]+decanFlow:\s*\[(.*?)\],.*?)\)"

# Better approach: find all decanName and decanFlow pairs
decan_blocks = []
current_block = None
in_decan_flow = False
flow_lines = []

lines = content.split('\n')
for i, line in enumerate(lines):
    # Look for decanName
    if 'decanName:' in line:
        # Save previous block if exists
        if current_block and flow_lines:
            current_block['flow'] = '\n'.join(flow_lines)
            decan_blocks.append(current_block)
        
        # Extract decan name
        match = re.search(r"decanName:\s*'([^']+)'", line)
        if match:
            current_block = {'name': match.group(1), 'flow': ''}
            flow_lines = []
            in_decan_flow = False
    
    # Look for decanFlow start
    if 'decanFlow:' in line and '[' in line:
        in_decan_flow = True
        flow_lines = [line]
        continue
    
    # Collect flow lines
    if in_decan_flow:
        flow_lines.append(line)
        if '],' in line or (']' in line and ',' in line):
            in_decan_flow = False
            if current_block:
                current_block['flow'] = '\n'.join(flow_lines)

# Save last block
if current_block and flow_lines:
    current_block['flow'] = '\n'.join(flow_lines)
    decan_blocks.append(current_block)

# Extract unique decans with their flows
decans = {}
for block in decan_blocks:
    name = block['name']
    flow_text = block['flow']
    
    # Extract DecanDayInfo entries from flow
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
        
        # Store unique flows (by checking the themes/actions)
        flow_key = tuple((d['day'], d['theme']) for d in sorted(flow, key=lambda x: x['day']))
        
        if name not in decans:
            decans[name] = []
        
        # Check if this flow is already stored
        flow_exists = False
        for existing_flow in decans[name]:
            existing_key = tuple((d['day'], d['theme']) for d in sorted(existing_flow, key=lambda x: x['day']))
            if existing_key == flow_key:
                flow_exists = True
                break
        
        if not flow_exists:
            decans[name].append(flow)

# Read decan descriptions from calendar_page.dart
with open('mobile/lib/features/calendar/calendar_page.dart', 'r', encoding='utf-8') as f:
    calendar_content = f.read()

# Extract _decanInfo array - get the full content
start_idx = calendar_content.find('const List<String> _decanInfo = [')
if start_idx != -1:
    end_idx = calendar_content.find('];', start_idx)
    if end_idx != -1:
        info_section = calendar_content[start_idx:end_idx+2]
        # Extract each description
        desc_pattern = r"'([^']+(?:—[^']+)?)'"
        desc_matches = re.findall(desc_pattern, info_section)
        
        descriptions = {}
        for desc_line in desc_matches:
            if '—' in desc_line:
                parts = desc_line.split('—', 1)
                if len(parts) == 2:
                    name_part = parts[0].strip()
                    desc = parts[1].strip()
                    # Try to extract the main name
                    name_match = re.search(r'([^("]+)', name_part)
                    if name_match:
                        clean_name = name_match.group(1).strip()
                        descriptions[clean_name] = desc

# Print all decan information
print("=" * 100)
print("ALL DECAN INFORMATION - COMPLETE")
print("=" * 100)
print()

# Sort decans by name
sorted_decans = sorted(decans.items())

for decan_name, flows in sorted_decans:
    print(f"\n{'='*100}")
    print(f"DECAN: {decan_name}")
    print(f"{'='*100}")
    
    # Try to find matching description
    desc_found = False
    # Extract the main part of decan name (before quotes)
    main_name = decan_name.split('(')[0].strip() if '(' in decan_name else decan_name
    
    for desc_name, desc in descriptions.items():
        # Try various matching strategies
        if (main_name.lower() in desc_name.lower() or 
            desc_name.lower() in main_name.lower() or
            any(word in desc_name.lower() for word in main_name.split() if len(word) > 3)):
            print(f"\nDESCRIPTION:")
            print(f"{desc}")
            desc_found = True
            break
    
    # Print all flows for this decan
    print(f"\n10-DAY FLOWS:")
    for flow_idx, flow in enumerate(flows, 1):
        if len(flows) > 1:
            print(f"\n  ─── Flow Variant {flow_idx} ───")
        for day_info in sorted(flow, key=lambda x: x['day']):
            print(f"\n    Day {day_info['day']}:")
            print(f"      Theme: {day_info['theme']}")
            print(f"      Action: {day_info['action']}")
            print(f"      Reflection: {day_info['reflection']}")

print(f"\n\n{'='*100}")
print(f"TOTAL UNIQUE DECANS: {len(decans)}")
print(f"{'='*100}")
