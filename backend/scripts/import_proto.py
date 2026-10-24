#!/usr/bin/env python3
"""Import the 2099-page registry from the prototype HTML into the database.

Mirrors the prototype's buildSeed (groups from slug paths, homepage, all pages
published) but stores content as JSON blocks/home fields with clean text.
"""
import asyncio
import json
import re
import sys
import uuid
from datetime import datetime
from pathlib import Path

sys.path.append(str(Path('/home/aut007/Downloads/medically_complicated_admin_panel/backend').resolve()))

from sqlalchemy import delete
from app.db.base import Base
from app import models  # noqa
from app.db.session import AsyncSessionLocal, engine
from app.models.group import Group
from app.models.page import Page
from app.crud.crud_group import crud_group
from app.crud.crud_user import crud_user
from app.services.sanitize import sanitize_content
from app.services.content_text import extract_clean_text

ROOT = Path('/home/aut007/Downloads/medically_complicated_admin_panel')

HOME_FIELDS = {
    "heroBtTitle": "Brain tumors", "heroBtText": "Clear medical explanations...",
    "heroBtBtn": "Start here", "heroEnTitle": "Endometriosis",
    "heroEnText": "Trustworthy information about endometriosis...",
    "heroEnBtn": "Start here",
    "intro": "Science and lived experience belong together.",
    "nbTitle": "Brain tumors", "nbText": "Understand the type and grade of a tumor...",
    "nbList": "What the diagnosis means\nQuestions for your neurologist\nCaring for yourself",
    "nbBtn": "Read the guide", "neTitle": "Endometriosis",
    "neText": "Learn what endometriosis is, why diagnosis often takes years...",
    "neList": "What endometriosis is\nPreparing for your gynecology visit\nManaging pain",
    "neBtn": "Read the guide",
    "stLede": "Stories from patients and caregivers appear here once they are reviewed.",
    "exLede": "Each condition section follows the same structure.",
    "exList": "Symptoms\nDiagnosis\nTreatment\nLiving with it\nResearch\nQuality of life\nResources\nAsk the community",
    "cmTitle": "Share, ask, connect",
    "cmText": "Tell your story, ask a question, or find a support group near you.",
    "cmBtn1": "Submit your story", "cmBtn2": "Join the community",
    "blLede": "Notes from the founder and occasional guest writers.",
    "bl1": "Post title goes here", "bl1s": "A short summary of the post.",
    "bl2": "Post title goes here", "bl2s": "A short summary of the post.",
    "bl3": "Post title goes here", "bl3s": "A short summary of the post.",
}

PH_BLOCKS = [{"type": "paragraph", "text": "Placeholder. The real text for this page is not in this prototype yet."}]


def extract_pages_array():
    html_path = ROOT / "mc-admin-proto-v8_2.html"
    text = html_path.read_text(errors="replace")
    m = re.search(r'const PAGES\s*=\s*(\[.*?\]);', text, re.DOTALL)
    if not m:
        raise RuntimeError("Could not extract PAGES array from prototype HTML")
    arr = m.group(1)
    try:
        return json.loads(arr)
    except Exception:
        arr2 = arr.replace("'", '"')
        return json.loads(arr2)


async def main():
    pages_list = extract_pages_array()
    print(f"✓ Extracted {len(pages_list)} pages")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        admin = await crud_user.get_by_email(db, email="admin@example.com")
        if not admin:
            from app.schemas.user import UserCreate
            admin = await crud_user.create(db, obj_in=UserCreate(
                email="admin@example.com", name="Admin", role="admin", password="admin123", is_active=True
            ))

        title_map = {slug: title for slug, title in pages_list}
        title_map[''] = 'Site pages'

        await db.execute(delete(Page))
        await db.execute(delete(Group))
        await db.commit()

        prefixes = set()
        for slug, _ in pages_list:
            parts = slug.split('/')
            for i in range(1, len(parts)):
                prefixes.add('/'.join(parts[:i]))
        prefixes = sorted(prefixes, key=lambda s: s.count('/'))

        id_map = {'': None}
        root = await crud_group.create(db, obj_in=__import__("app.schemas.group").schemas.group.GroupCreate(name="Site pages"))
        id_map[''] = root.id

        for pfx in prefixes:
            parent = '/'.join(pfx.split('/')[:-1]) if '/' in pfx else ''
            parent_id = id_map.get(parent, root.id)
            parts = pfx.split('/')
            name = title_map.get(pfx) or parts[-1]
            g = Group(id=uuid.uuid4(), name=name, parent_id=parent_id)
            db.add(g)
            await db.flush()
            await crud_group._assign_path(db, g)
            id_map[pfx] = g.id
        await db.commit()

        # Homepage
        home_c = {"format": "home-v1", "fields": HOME_FIELDS}
        home_p = Page(id=uuid.uuid4(), group_id=root.id,
                      title="Homepage", slug="home", lang="en", status="published",
                      content=sanitize_content(home_c), content_text=extract_clean_text(home_c),
                      is_homepage=True, author_id=admin.id, last_edited_by_id=admin.id,
                      live_title="Homepage", live_slug="home",
                      live_content=sanitize_content(home_c), live_content_text=extract_clean_text(home_c),
                      live_group_id=root.id, published_at=datetime.utcnow())
        db.add(home_p)

        # Pages
        imported = 0
        for slug, title in pages_list:
            parent = '/'.join(slug.split('/')[:-1]) if '/' in slug else ''
            gid = id_map.get(slug) or id_map.get(parent) or root.id
            content = sanitize_content({"format": "blocks-v1", "blocks": PH_BLOCKS})
            ct = extract_clean_text(content)
            p = Page(id=uuid.uuid4(), group_id=gid, title=title, slug=slug, lang="en",
                     status="published", content=content, content_text=ct,
                     author_id=admin.id, last_edited_by_id=admin.id,
                     live_title=title, live_slug=slug, live_content=content,
                     live_content_text=ct, live_group_id=gid,
                     published_at=datetime.utcnow())
            db.add(p)
            imported += 1
            if imported % 500 == 0:
                await db.flush()
        await db.commit()
        print(f"✓ Imported homepage + {imported} pages")


if __name__ == "__main__":
    asyncio.run(main())
