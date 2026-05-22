import pandas as pd
import requests
import time
import os
from dotenv import load_dotenv

load_dotenv('api_key.env')
API_KEY = os.getenv('OMDB_API_KEY')

INPUT_FILE = 'dw_database_ai_script.csv'
OUTPUT_FILE = 'doctor_who_database_final.csv'

# Mapping series_type to imdb id
SERIES_MAP = {
    'classic': 'tt0056751',  # 1963-1989
    'modern': 'tt0436992',
    'newera': 'tt23615096'
}

def get_imdb_data(imdb_id, season, episode):
    """Fetches rating and plot from OMDb using precise Series ID."""
    if not API_KEY:
        print("Error: OMDB_API_KEY not found in .env file")
        return None
        
    url = f"http://www.omdbapi.com/?apikey={API_KEY}&i={imdb_id}&Season={season}&Episode={episode}"
    
    try:
        response = requests.get(url)
        data = response.json()
        
        if data.get('Response') == 'True':
            return {
                'rating': data.get('imdbRating'),
                'plot': data.get('Plot')
            }
        return None
    except Exception as e:
        print(f"Connection error for S{season}E{episode}: {e}")
        return None

def main():
    # Load your database
    try:
        df = pd.read_csv(INPUT_FILE)
    except FileNotFoundError:
        print(f"Error: {INPUT_FILE} not found.")
        return

    # Ensure target columns exist and force them to 'object' type to prevent crashes
    if 'imdb_rating' not in df.columns:
        df['imdb_rating'] = None
    df['imdb_rating'] = df['imdb_rating'].astype(object)

    if 'plot_summary' not in df.columns:
        df['plot_summary'] = None
    df['plot_summary'] = df['plot_summary'].astype(object)

    print(f"Starting update. Using API Key: {API_KEY[:4]}****")

    for index, row in df.iterrows():

        # Skip specials
        if str(row['season']).lower() == 'special' or str(row['episode']).lower() == 'special':
            continue
            
        # Check series type and map to id
        series_tag = str(row['series_type']).strip().lower()
        imdb_id = SERIES_MAP.get(series_tag)
        
        if imdb_id:
            result = get_imdb_data(imdb_id, row['season'], row['episode'])
            
            if result:
                df.at[index, 'imdb_rating'] = result['rating']
                df.at[index, 'plot_summary'] = result['plot']
                print(f"Success: {series_tag.capitalize()} S{row['season']}E{row['episode']}")
            else:
                print(f"Skipped: Data not found for {series_tag} S{row['season']}E{row['episode']}")

        if index % 10 == 0:
            df.to_csv(OUTPUT_FILE, index=False)
        
        time.sleep(0.6)

    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\nTask Complete! Check {OUTPUT_FILE} for your data.")

if __name__ == "__main__":
    main()