from typing import Dict, Any
import re


def strip_html(text: str) -> str:
    if not text:
        return ""
    # Remove HTML tags
    clean = re.compile('<.*?>')
    text = re.sub(clean, ' ', text)
    # Decode HTML entities
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def extract_clean_text(content: Dict[str, Any] | None) -> str:
    if not content:
        return ""
    
    texts = []
    
    # Handle common patterns
    if isinstance(content, dict):
        # body (HTML or plain)
        if 'body' in content and content['body']:
            texts.append(strip_html(str(content['body'])))
        
        # text (plain)
        if 'text' in content and content['text']:
            texts.append(str(content['text']))
        
        # blocks
        if 'blocks' in content and isinstance(content['blocks'], list):
            for block in content['blocks']:
                if isinstance(block, dict):
                    if block.get('text'):
                        texts.append(str(block['text']))
                    if block.get('items') and isinstance(block['items'], list):
                        for item in block['items']:
                            texts.append(str(item))
                    # handle other fields
                    for key in ['title', 'caption', 'description', 'label']:
                        if key in block and block[key]:
                            texts.append(str(block[key]))
        
        # sections
        if 'sections' in content and isinstance(content['sections'], list):
            for section in content['sections']:
                if isinstance(section, dict) and section.get('text'):
                    texts.append(str(section['text']))
        
        # fields pattern (for homepage etc)
        for key, value in content.items():
            if key not in ['body', 'text', 'blocks', 'sections'] and isinstance(value, str) and value:
                # Avoid URLs and code
                if len(value) < 500:  # add as excerpt-like text
                    texts.append(value)
    
    result = ' '.join(texts)
    return strip_html(result)
