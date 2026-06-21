import pandas as pd
import requests
import os
import re
import urllib.parse
import time
from groq import Groq
from dotenv import load_dotenv

# 1. Load Keys
load_dotenv("api_key.env") 
GROQ_KEY = os.getenv("GROQ_API_KEY")
# OMDB_KEY = os.getenv("OMDB_API_KEY")

# 2. Setup AI (Using the stable GenerativeModel method)
client = Groq(api_key=os.getenv("GROQ_API_KEY"))
MODEL_ID = "llama-3.3-70b-versatile"

# 3. Load data with Latin1 for special characters (The Dæmons fix)
df = pd.read_csv('doctor_who_database_before.csv', encoding='latin1')

# 4. Force columns to 'object' type to prevent LossySetitemError
target_cols = ['imdb_rating', 'plot_summary', 'episode_mood', 'vibe_tags', 'villains', 'setting']
for col in target_cols:
    if col in df.columns:
        df[col] = df[col].astype(object)

def get_groq_vibes(row):
    prompt = f"""
    Doctor Who Story: {row['story_title']}. Doctor: {row['doctor_num']}.
    Provide ONLY the following data in this format:
    MOOD: [2-5 words describing the emotional impact, example: Bittersweet, Terrifying, Sad etc. List one-word tags using a ,]
    VIBES: [Generate 2-5 one-word tags that describe the genre or setting style, do not use sci-fi at all as the whole show as sci-fi genre. List one-word tags using a ,]
    VILLAINS: [List main villains (e.g.: Daleks, Cybermen, The Master etc), if no villian in the episode list "None"]
    SETTING: [Main location/setting (e.g. London, Space, Tardis etc), Time Period (Past/Present/Future), Specific Year (if known). Consider present years 2010-2028]
    """
    try:
        # Using the standard Groq Chat Completion call
        completion = client.chat.completions.create(
            model=MODEL_ID,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5,
            max_tokens=200
        )
        return completion.choices[0].message.content
    except Exception as e:
        print(f"Groq Error on {row['story_title']}: {e}")
        return ""

import time

def process_data():
    print(f"Starting Enrichment for {len(df)} rows...")
    
    for index, row in df.iterrows():

        #OG IMDB CODE REMAINS LEAVE JUST IN CASE
         
        # row_year = row.get('year')
        # row_season = row.get('season')
        # row_episode = row.get('episode')

        # rating, plot = get_imdb_data(
        #     row['story_title'], 
        #     year=row_year, 
        #     season=row_season, 
        #     episode=row_episode
        # )


        # skipping filled rows

        if pd.notnull(df.at[index, 'episode_mood']) and df.at[index, 'episode_mood'] != "":
           continue


        # df.at[index, 'imdb_rating'] = str(rating) if rating else None
        # df.at[index, 'plot_summary'] = str(plot) if plot else None
        
        # 2. Get Groq Data
        ai_text = get_groq_vibes(row)
        
        if ai_text:
            try:
                # Adding re.IGNORECASE and handling None types to prevent crashes
                mood = re.search(r"MOOD:\s*(.*)", ai_text, re.IGNORECASE)
                vibes = re.search(r"VIBES:\s*(.*)", ai_text, re.IGNORECASE)
                villains = re.search(r"VILLAINS:\s*(.*)", ai_text, re.IGNORECASE)
                setting = re.search(r"SETTING:\s*(.*)", ai_text, re.IGNORECASE)
                
                if mood: df.at[index, 'episode_mood'] = mood.group(1).strip()
                if vibes: df.at[index, 'vibe_tags'] = vibes.group(1).strip()
                if villains: df.at[index, 'villains'] = villains.group(1).strip()
                if setting: df.at[index, 'setting'] = setting.group(1).strip()
            except Exception as e:
                print(f"Parsing error on index {index}: {e}")
            
        print(f"[{index + 1}/893] Processed: {row['story_title']}")

        # save every 10 rows so i dont lose everything again
        if index % 10 == 0:
            df.to_csv('doctor_who_database_before.csv', index=False, encoding='latin1')

        time.sleep(2.2)

    # Final Save
    df.to_csv('dw_database_ai_script.csv', index=False, encoding='utf-8-sig')
    print("Successuflly processed")

if __name__ == "__main__":
    process_data()