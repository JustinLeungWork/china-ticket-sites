"""
Weekly exchange rate updater for china-ticket-sites locale pages.
Fetches live USD rates from open.er-api.com (free, no key) and patches
the hardcoded `rate=` value in each locale's inline currency script.
Commits and pushes if anything changed.

Run manually:  python scripts/update_rates.py
Scheduled:     weekly via Windows Task Scheduler (see scripts/schedule_rates.ps1)
"""
import re, os, json, sys, subprocess
from urllib.request import urlopen
from urllib.error import URLError
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# currency → list of locale subdirs that hardcode it
LOCALE_CURRENCY = {
    'KRW': ['terracotta/ko', 'mutianyu/ko', 'zhangjiajie/ko'],
    'JPY': ['terracotta/ja', 'mutianyu/ja', 'zhangjiajie/ja'],
    'IDR': ['terracotta/id', 'mutianyu/id', 'zhangjiajie/id'],
    'THB': ['terracotta/th', 'mutianyu/th', 'zhangjiajie/th'],
    'EUR': [
        'terracotta/es', 'terracotta/fr', 'terracotta/pt',
        'mutianyu/fr',   'mutianyu/pt',
        'zhangjiajie/fr','zhangjiajie/pt',
    ],
}

API_URL = 'https://open.er-api.com/v6/latest/USD'


def fetch_rates():
    try:
        with urlopen(API_URL, timeout=15) as r:
            data = json.loads(r.read())
        if data.get('result') != 'success':
            raise ValueError(f"API error: {data}")
        return data
    except URLError as e:
        print(f"ERROR fetching rates: {e}", file=sys.stderr)
        sys.exit(1)


def format_rate(currency, raw):
    """Round to a sensible precision for display."""
    if currency in ('KRW', 'JPY', 'IDR', 'THB'):
        return round(raw)          # whole numbers
    return round(raw, 4)           # EUR etc — 4 decimal places


def patch_file(path, new_rate):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # matches: var sym='...',rate=<number>  (with or without ,round=...)
    new = re.sub(
        r"(var sym='[^']+',rate=)[\d.]+",
        rf'\g<1>{new_rate}',
        content, count=1
    )
    if new == content:
        return False
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new)
    return True


def main():
    print(f"Fetching rates from {API_URL}…")
    data = fetch_rates()
    update_time = data.get('time_last_update_utc', 'unknown')
    rates = data['rates']

    print(f"Rate date: {update_time}")
    for cur in LOCALE_CURRENCY:
        print(f"  USD → {cur}: {rates[cur]:.4f}")

    changed = []

    for currency, locales in LOCALE_CURRENCY.items():
        new_rate = format_rate(currency, rates[currency])
        for rel in locales:
            path = os.path.join(BASE, rel, 'index.html')
            if not os.path.exists(path):
                print(f"  SKIP (not found): {rel}")
                continue
            if patch_file(path, new_rate):
                print(f"  UPDATED {rel}  → rate={new_rate}")
                changed.append(rel)
            else:
                print(f"  unchanged {rel}")

    if not changed:
        print("\nNo rate changes — nothing to commit.")
        return

    date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    msg = (
        f"chore(rates): weekly exchange rate update {date_str}\n\n"
        + '\n'.join(f'  {r}: {LOCALE_CURRENCY[[k for k,v in LOCALE_CURRENCY.items() if r in v][0]]}' for r in changed[:5])
        + ('\n  …and more' if len(changed) > 5 else '')
        + '\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>'
    )

    os.chdir(BASE)
    subprocess.run(['git', 'add', '-A'], check=True)
    subprocess.run(['git', 'commit', '-m', msg], check=True)
    subprocess.run(['git', 'push'], check=True)
    print(f"\nPushed {len(changed)} updated file(s).")


if __name__ == '__main__':
    main()
