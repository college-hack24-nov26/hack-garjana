# push_parts.ps1
# Script to push project parts at uneven intervals

$remoteUrl = "https://github.com/college-hack24-nov26/hack-garjana.git"

# Ensure remote is set
if (!(git remote | Select-String "origin")) {
    git remote add origin $remoteUrl
}
git branch -M main

$logFile = "D:\TWIN ANIMATION\push_log.txt"
function Log-Progress($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp : $msg" | Out-File -FilePath $logFile -Append
    Write-Host $msg
}

Log-Progress "Starting upload process..."
# Define parts
$parts = @(
    @{ "name" = "Part 2: Backend API and Core"; "path" = "Backend/backend/app/api/ Backend/backend/app/core/ Backend/backend/app/db/" },
    @{ "name" = "Part 3: Backend Engineering"; "path" = "Backend/backend/app/engineering/" },
    @{ "name" = "Part 4: Backend Services and Schemas"; "path" = "Backend/backend/app/services/ Backend/backend/app/schemas/ Backend/backend/app/tests/" },
    @{ "name" = "Part 5: Frontend Components"; "path" = "Backend/frontend/src/components/ Backend/frontend/src/engine/" },
    @{ "name" = "Part 6: Frontend Pages and Rest"; "path" = "Backend/frontend/src/pages/ Backend/frontend/src/services/ Backend/frontend/src/store/ Backend/frontend/src/types/ Backend/frontend/src/viewer/ Backend/frontend/src/wizard/ Backend/frontend/App.tsx Backend/frontend/main.tsx" },
    @{ "name" = "Part 7: Remaining Files"; "path" = "." }
)

# Intervals in seconds: 10 min, 15 min, 20 min, 20 min, 15 min
$intervals = @(600, 900, 1200, 1200, 900)

for ($i = 0; $i -lt $parts.Count; $i++) {
    $interval = $intervals[$i]
    Log-Progress "Waiting for $($interval/60) minutes before pushing next part..."
    Start-Sleep -Seconds $interval

    $part = $parts[$i]
    Log-Progress "Pushing $($part.name)..."
    
    # Add files for this part
    foreach ($p in $part.path -split " ") {
        if ($p -ne "") {
            git add $p
        }
    }
    
    # Commit and push
    git commit -m "Upload $($part.name)"
    git push origin main
}

Log-Progress "Task completed successfully."
