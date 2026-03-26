import copy
import cv2
import numpy as np
from shapely.geometry import Polygon, box, Point
from scipy.spatial import ConvexHull
import random
import time
from threading import Thread
import copy

from dotenv import load_dotenv
import re
import boto3
from botocore.exceptions import ClientError



class RTSP_Stream_Reader(object):
    """
    RTSP Streaming class
    """
    def _init_(self, url):
        """
        Initialize class by passing in url which can be a RTSP URL or video path since we are using cv2.VideoCapture for this.
        """
        self.url=url
        self.frame = None
        self.capture = cv2.VideoCapture(self.url)
        self.fps=int(self.capture.get(cv2.CAP_PROP_FPS))
        # Start the thread to read frames from the video stream
        self.thread = Thread(target=self.update, args=())
        self.thread.daemon = True
        self.thread.start()
        #self.sleep_to_match_fps=1/fps
        print("Stream object initialized")
        
    def update(self):
        """
        This will keep on reading frames from RTSP. This is done since read operation of cv2.VideoCapture.read is a blocking operation. 
        To stop this function, call self.stop() which will change value of self.stop_thread to True. 
        We can manually change value of self.stop_thread as well which will stop read thread eventually 
        but stop() returns True if read thread stops successfully.  
        If video capture doesn't open, we exit the function.
        """
        # Read the next frame from the stream in a different thread
        self.stop_thread=False
        self.thread_stopped=False
        while not self.stop_thread:
            if self.capture.isOpened():
                (self.status, self.frame) = self.capture.read()
            time.sleep(.01)
            #time.sleep(self.sleep_to_match_fps)
        self.thread_stopped=True
            
    def restart(self):
        self.stop()
        del self.capture
        self.frame=None
        self.capture = cv2.VideoCapture(self.url)
        # Start the thread to read frames from the video stream
        self.thread = Thread(target=self.update, args=())
        self.thread.daemon = True
        self.thread.start()
        print("Stream read thread restarted successfully.")
        
    def stop(self):
        self.stop_thread=True
        #Logic is that this will keep on running until update function changes the value back to false
        while(not self.thread_stopped):
            continue
        self.capture.release()
        print("Update thread stopped explicitly.")

def calculate_slope_intercept(point1, point2):
    """
    Calculate the slope (m) and y-intercept (b) of a line passing through two points.

    Args:
    - point1 (tuple): The first point (x1, y1).
    - point2 (tuple): The second point (x2, y2).

    Returns:
    - (tuple): A tuple containing the slope (m) and y-intercept (b).
    """
    x1, y1 = point1
    x2, y2 = point2
    
    # Check if the line is vertical to avoid division by zero
    if x1 == x2:
        raise ValueError("The line is vertical; slope is undefined.")
    
    # Calculate the slope (m)
    slope = (y2 - y1) / (x2 - x1)
    
    # Calculate the y-intercept (b)
    intercept = y1 - slope * x1
    
    return slope, intercept
    
def has_crossed_line_left_to_right(point1, point2, slope, intercept):
    """
    Check if an object has crossed an inclined line from left to right in 2D space.

    Args:
    - point1 (tuple): The first point (x1, y1) of the object's position.
    - point2 (tuple): The second point (x2, y2) of the object's position.
    - slope (float): The slope (m) of the line.
    - intercept (float): The y-intercept (b) of the line.

    Returns:
    - bool: True if the object has crossed the line from left to right, False otherwise.
    """
    x1, y1 = point1
    x2, y2 = point2

    # Calculate x positions on the line for given y coordinates
    x_line1 = (y1 - intercept) / slope
    x_line2 = (y2 - intercept) / slope

    # Check if point1 is on the left and point2 is on the right of the line
    if x1 < x_line1 and x2 > x_line2:
        return True
    return False
    
# function to display the coordinates of 
# of the points clicked on the image  
def click_event(event, x, y, flags, params): 

    global arr,temp_img
    # checking for left mouse clicks 
    if event == cv2.EVENT_LBUTTONDOWN: 
  
        # displaying the coordinates 
        # on the Shell 
        #print(x, ' ', y) 
  
        # displaying the coordinates 
        # on the image window 
        font = cv2.FONT_HERSHEY_SIMPLEX 
        cv2.putText(temp_img, str(x) + ',' +
                    str(y), (x,y), font, 
                    1, (255, 0, 0), 2) 
        cv2.imshow('image', temp_img) 

        arr.append([x,y])

  
    # checking for right mouse clicks      
    if event==cv2.EVENT_RBUTTONDOWN: 
  
        # displaying the coordinates 
        # on the Shell 
        print(x, ' ', y) 
  
        # displaying the coordinates 
        # on the image window 
        font = cv2.FONT_HERSHEY_SIMPLEX 
        b = temp_img[y, x, 0] 
        g = temp_img[y, x, 1] 
        r = temp_img[y, x, 2] 
        cv2.putText(temp_img, str(b) + ',' +
                    str(g) + ',' + str(r), 
                    (x,y), font, 1, 
                    (255, 255, 0), 2) 
        cv2.imshow('image', temp_img) 
        

def upload_npy(ssm_client,s3_client,arn,local_path):
    pattern = r's3://([^/]+)/(.*)'
    response=ssm_client.get_parameters(Names=[arn])
    roi_s3_uri=response['Parameters'][0]['Value']
    match = re.match(pattern, roi_s3_uri)     
    bucket_name = match.group(1)
    object_key = match.group(2)
    try:
        response = s3_client.upload_file(local_path, bucket_name, object_key)
    except ClientError as e:
        print("Upload Failed.")
        return False
    return True
    
def main():

    global arr,temp_img

    load_dotenv('environment.env')
    arr=list()
    colors=[(3, 251, 255),(14,255,3),(224,3,255)]
    thickness=2

    rtsp_url="/Users/dhyanesh/blinkit_loading/3rd_march.mkv"
    #rtsp_url=r"D:\Downloads\OneRoot\TCC\Coconut Dataset\Collection Centre\CCTV\DS-2CD1343G2-LIUF\D01_20240901134838.mp4"
    image_path="rtsp-sample.jpg"
    roi_path='roi.npy'
    input_path="input.npy"
    output_path="output.npy"


    s3_client = boto3.client('s3')
    sns_arn='arn:aws:sns:ap-southeast-1:992382538762:inference'
    sns_client = boto3.client('sns', region_name='ap-southeast-1')
    ssm_client = boto3.client('ssm',region_name='ap-southeast-1')

    arn={'input':'arn:aws:ssm:ap-southeast-1:992382538762:parameter/streams/stream1/Input_Line_S3_URI',
        'output':'arn:aws:ssm:ap-southeast-1:992382538762:parameter/streams/stream1/Output_Line_S3_URI',
         'roi':'arn:aws:ssm:ap-southeast-1:992382538762:parameter/streams/stream1/Counting_ROI_S3_URI'}
    local_path={'roi':roi_path,'input':input_path,'output':output_path}


    start_x=10
    start_y=30



    # Once you have saved the image in local machine commnet out the below code

    stream=RTSP_Stream_Reader(rtsp_url)
    time.sleep(5)
    while True:
        frame=stream.frame
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
        cv2.imshow('RTSP', frame)
    cv2.imwrite(image_path,frame)
    cv2.destroyAllWindows()
    stream.stop()



    img = cv2.imread(image_path)
    temp_img=copy.deepcopy(img)

    while True:
        # displaying the image 

        cv2.putText(temp_img,"Draw Polygon",(10,start_y), cv2.FONT_HERSHEY_SIMPLEX,1,colors[0],3)
        cv2.putText(temp_img,"Click points",(10,start_y+90), cv2.FONT_HERSHEY_SIMPLEX,1,colors[0],2)
        cv2.putText(temp_img,"Press Q to confirm and go to next",(10,start_y+120), cv2.FONT_HERSHEY_SIMPLEX,1,colors[0],2)
        cv2.putText(temp_img,"Press R to reset drawing",(10,start_y+150), cv2.FONT_HERSHEY_SIMPLEX,1,colors[0],2)
        cv2.putText(temp_img,"Press Enter to view drawn figure.",(10,start_y+180), cv2.FONT_HERSHEY_SIMPLEX,1,colors[0],2)
        cv2.imshow('image', temp_img) 
       
        
        # setting mouse handler for the image 
        # and calling the click_event() function 
        cv2.setMouseCallback('image', click_event) 

        #Quit
        if cv2.waitKey(1) == ord("q"):
            break
        #Redo
        if cv2.waitKey(1) == ord("r"):
            arr=list()
            temp_img=copy.deepcopy(img)
            continue
        #Next
        if cv2.waitKey(1) == 13:
            temp_img=copy.deepcopy(img)
            roi=np.array(arr)
            hull = ConvexHull(roi)
            convex_points = roi[hull.vertices]
            # Close the polygon by appending the first point if necessary
            if not np.array_equal(convex_points[0], convex_points[-1]):
                convex_points = np.vstack([convex_points, convex_points[0]])
            cv2.polylines(temp_img, [convex_points], True, colors[0], thickness)
            continue

    np.save(roi_path,convex_points)
    arr=list()
    cv2.polylines(img, [convex_points], True, colors[0], thickness)
    temp_img=copy.deepcopy(img)

    # while True:
    #     # displaying the image 
    #     cv2.putText(temp_img,"Draw Input Line",(10,start_y), cv2.FONT_HERSHEY_SIMPLEX,1,colors[1],3)
    #     cv2.putText(temp_img,"Click Two points",(10,start_y+90), cv2.FONT_HERSHEY_SIMPLEX,1,colors[1],2)
    #     cv2.putText(temp_img,"Press Q to confirm and go to next",(10,start_y+120), cv2.FONT_HERSHEY_SIMPLEX,1,colors[1],2)
    #     cv2.putText(temp_img,"Press R to reset drawing",(10,start_y+150), cv2.FONT_HERSHEY_SIMPLEX,1,colors[1],2)
    #     cv2.putText(temp_img,"Press Enter to view drawn Line.",(10,start_y+180), cv2.FONT_HERSHEY_SIMPLEX,1,colors[1],2)
    #     cv2.imshow('image', temp_img) 
        
    #     # setting mouse handler for the image 
    #     # and calling the click_event() function 
    #     cv2.setMouseCallback('image', click_event) 

    #     #Quit
    #     if cv2.waitKey(1) == ord("q"):
    #         break
    #     #Redo
    #     if cv2.waitKey(1) == ord("r"):
    #         arr=list()
    #         temp_img=copy.deepcopy(img)
    #         continue
    #     #Next
    #     if (cv2.waitKey(1) == 13) or (len(arr)==2):
    #         temp_img=copy.deepcopy(img)
    #         start,end=arr[0],arr[1]
    #         temp_img = cv2.line(temp_img, start,end, colors[1], thickness)
    #         continue


    # np.save(input_path,np.array(arr[:2]))
    # if(len(arr)>=2):
    #     start,end=arr[0],arr[1]
    #     img = cv2.line(img, start,end, colors[1], thickness)
    # temp_img=copy.deepcopy(img)
    # arr=list()


    # while True:
    #     # displaying the image 

    #     cv2.putText(temp_img,"Draw Output Line",(10,start_y), cv2.FONT_HERSHEY_SIMPLEX,1,colors[2],3)
    #     cv2.putText(temp_img,"Click Two points",(10,start_y+90), cv2.FONT_HERSHEY_SIMPLEX,1,colors[2],2)
    #     cv2.putText(temp_img,"Press Q to confirm and go to next",(10,start_y+120), cv2.FONT_HERSHEY_SIMPLEX,1,colors[2],2)
    #     cv2.putText(temp_img,"Press R to reset drawing",(10,start_y+150), cv2.FONT_HERSHEY_SIMPLEX,1,colors[2],2)
    #     cv2.putText(temp_img,"Press Enter to view drawn line.",(10,start_y+180), cv2.FONT_HERSHEY_SIMPLEX,1,colors[2],2)
    #     cv2.imshow('image', temp_img) 
         
    #     # setting mouse handler for the image 
    #     # and calling the click_event() function 
    #     cv2.setMouseCallback('image', click_event) 

    #     #Quit
    #     if cv2.waitKey(1) == ord("q"):
    #         break
    #     #Redo
    #     if cv2.waitKey(1) == ord("r"):
    #         arr=list()
    #         temp_img=copy.deepcopy(img)
    #         continue
    #     #Next
    #     if (cv2.waitKey(1) == 13) or (len(arr)==2):
    #         temp_img=copy.deepcopy(img)
    #         start,end=arr[0],arr[1]
    #         temp_img = cv2.line(temp_img, start,end, colors[2], thickness)
    #         continue

    # np.save(output_path,np.array(arr[:2]))
    # if(len(arr)>=2):
    #     start,end=arr[0],arr[1]
    #     img = cv2.line(img, start,end, colors[2], thickness)
    # temp_img=copy.deepcopy(img)


    while True:
        # displaying the image 

        cv2.putText(temp_img,"Final Version",(10,start_y), cv2.FONT_HERSHEY_SIMPLEX,1,colors[0],3)
        cv2.putText(temp_img,"Press Q to confirm and upload ROI to S3",(10,start_y+90), cv2.FONT_HERSHEY_SIMPLEX,1,colors[0],2)
        cv2.imshow('image', temp_img) 
         
        #Quit
        if cv2.waitKey(1) == ord("q"):
            break

    # close the window 
    cv2.destroyAllWindows() 


    # flag=True
    # for key in local_path.keys():
    #     if(not upload_npy(ssm_client,s3_client,arn[key],local_path[key])):
    #         flag=False
    # if(flag):
    #     print("Upload Successful. Sending messages to SNS topic")
    #     response = sns_client.publish(TopicArn=sns_arn, Message="Change ROI")
    # else:
    #     print("Upload NOT Successful. Won't be sending message to SNS topic so as to not cause issues for inference.")
        
if _name=="main_":
    main()