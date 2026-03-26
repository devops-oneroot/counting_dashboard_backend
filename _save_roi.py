import numpy as np, json
with open('roi_points_temp.json') as f:
    pts = json.load(f)
arr = np.array([[p['x'], p['y']] for p in pts])
np.save('roi.npy', arr)
print(f"Saved {len(arr)} points to roi.npy")
